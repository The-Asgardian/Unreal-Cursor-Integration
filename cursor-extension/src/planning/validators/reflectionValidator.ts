import { Plan, ValidationIssue, ValidationContext } from '../types';
import { ConnectionManager } from '../../ipc/connectionManager';

/**
 * Validates plan against Unreal Engine reflection system
 */
export class ReflectionValidator {
    constructor(
        private connectionManager: ConnectionManager,
        private context: ValidationContext
    ) {}

    /**
     * Validate plan using reflection system
     */
    async validate(plan: Plan): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        if (!this.context.connectionState?.connected) {
            issues.push({
                type: 'reflection',
                severity: 'warning',
                message: 'Cannot perform reflection validation: Unreal Editor not connected',
                suggestion: 'Connect to Unreal Editor to enable reflection validation'
            });
            return issues;
        }

        // Extract all symbols from plan
        const symbols = this.extractSymbols(plan);

        // Validate each symbol
        for (const symbol of symbols) {
            const symbolIssues = await this.validateSymbol(symbol);
            issues.push(...symbolIssues);
        }

        return issues;
    }

    /**
     * Extract all symbols (classes, functions, properties) from plan
     */
    private extractSymbols(plan: Plan): Array<{ type: string; name: string; location?: { file?: string; line?: number } }> {
        const symbols: Array<{ type: string; name: string; location?: { file?: string; line?: number } }> = [];

        // Extract from code snippets
        if (plan.codeSnippets) {
            for (const snippet of plan.codeSnippets) {
                if (snippet.symbols) {
                    for (const symbol of snippet.symbols) {
                        symbols.push({
                            type: symbol.type,
                            name: symbol.name,
                            location: symbol.location
                        });
                    }
                }
            }
        }

        // Extract from todos (look for class/function names in descriptions)
        for (const todo of plan.todos) {
            const classMatches = todo.content.match(/\b([A-Z][a-zA-Z0-9_]*)\s*(?:class|Class)\b/g);
            if (classMatches) {
                for (const match of classMatches) {
                    const className = match.replace(/\s*(?:class|Class)\b/, '').trim();
                    if (className && !symbols.some(s => s.name === className && s.type === 'class')) {
                        symbols.push({ type: 'class', name: className });
                    }
                }
            }
        }

        return symbols;
    }

    /**
     * Validate a single symbol against reflection system
     */
    private async validateSymbol(symbol: { type: string; name: string; location?: { file?: string; line?: number } }): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        try {
            if (symbol.type === 'class') {
                const classResult = await this.connectionManager.sendRequest('reflection.getClass', {
                    className: symbol.name
                });

                if (!classResult || !classResult.name) {
                    issues.push({
                        type: 'reflection',
                        severity: 'error',
                        message: `Class '${symbol.name}' not found in reflection system`,
                        location: symbol.location,
                        suggestion: `Verify the class name is correct and the class is loaded in Unreal Editor`
                    });
                } else {
                    // Validate inheritance if mentioned
                    // This would require parsing the plan more deeply
                }
            } else if (symbol.type === 'function') {
                // Try to find function in reflection system
                const symbolResult = await this.connectionManager.sendRequest('reflection.findSymbol', {
                    symbolName: symbol.name
                });

                if (!symbolResult || symbolResult.symbolType !== 'function') {
                    issues.push({
                        type: 'reflection',
                        severity: 'warning',
                        message: `Function '${symbol.name}' not found in reflection system`,
                        location: symbol.location,
                        suggestion: `Function may be a C++ only function (not exposed to reflection) or may not exist`
                    });
                }
            } else if (symbol.type === 'property') {
                // Try to find property in reflection system
                const symbolResult = await this.connectionManager.sendRequest('reflection.findSymbol', {
                    symbolName: symbol.name
                });

                if (!symbolResult || symbolResult.symbolType !== 'property') {
                    issues.push({
                        type: 'reflection',
                        severity: 'warning',
                        message: `Property '${symbol.name}' not found in reflection system`,
                        location: symbol.location,
                        suggestion: `Property may not be exposed with UPROPERTY() macro`
                    });
                }
            }
        } catch (error) {
            issues.push({
                type: 'reflection',
                severity: 'error',
                message: `Error validating symbol '${symbol.name}': ${error instanceof Error ? error.message : 'Unknown error'}`,
                location: symbol.location
            });
        }

        return issues;
    }
}

