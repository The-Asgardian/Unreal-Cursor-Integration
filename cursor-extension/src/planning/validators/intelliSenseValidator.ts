import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Plan, ValidationIssue, ValidationContext, CodeSnippet } from '../types';
import { ConnectionManager } from '../../ipc/connectionManager';
import { UHTDiagnosticsManager } from '../../diagnostics/uhtDiagnostics';

/**
 * Validates plan using IntelliSense and compilation diagnostics
 */
export class IntelliSenseValidator {
    private uhtDiagnosticsManager: UHTDiagnosticsManager;

    constructor(
        private connectionManager: ConnectionManager,
        private context: ValidationContext
    ) {
        this.uhtDiagnosticsManager = new UHTDiagnosticsManager();
    }

    /**
     * Validate plan using IntelliSense
     */
    async validate(plan: Plan): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        // Check if compile_commands.json exists
        const compileCommandsPath = this.context.compileCommandsPath || 
            path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.vscode', 'compile_commands.json');

        if (!fs.existsSync(compileCommandsPath)) {
            issues.push({
                type: 'intellisense',
                severity: 'warning',
                message: 'compile_commands.json not found. IntelliSense validation may be limited.',
                suggestion: 'Run "Unreal: Generate compile_commands.json" to generate it'
            });
        }

        // Run UHT check if connected
        if (this.context.connectionState?.connected) {
            try {
                const uhtResult = await this.connectionManager.sendRequest('uht.runCheck', {});
                
                if (uhtResult && uhtResult.diagnostics) {
                    for (const diagnostic of uhtResult.diagnostics) {
                        // Check if diagnostic is related to files mentioned in plan
                        const isRelevant = this.isDiagnosticRelevant(diagnostic, plan);
                        
                        if (isRelevant) {
                            issues.push({
                                type: 'intellisense',
                                severity: diagnostic.severity === 'error' ? 'error' : 'warning',
                                message: diagnostic.message || 'UHT diagnostic',
                                location: {
                                    file: diagnostic.file,
                                    line: diagnostic.line,
                                    symbol: diagnostic.symbol
                                },
                                suggestion: this.getUHTSuggestion(diagnostic)
                            });
                        }
                    }
                }
            } catch (error) {
                issues.push({
                    type: 'intellisense',
                    severity: 'warning',
                    message: `Failed to run UHT check: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    suggestion: 'UHT validation skipped'
                });
            }
        } else {
            issues.push({
                type: 'intellisense',
                severity: 'info',
                message: 'UHT check skipped: Unreal Editor not connected',
                suggestion: 'Connect to Unreal Editor to enable UHT validation'
            });
        }

        // Validate code snippets for common issues
        if (plan.codeSnippets) {
            for (const snippet of plan.codeSnippets) {
                const snippetIssues = this.validateCodeSnippet(snippet);
                issues.push(...snippetIssues);
            }
        }

        return issues;
    }

    /**
     * Check if a UHT diagnostic is relevant to the plan
     */
    private isDiagnosticRelevant(diagnostic: any, plan: Plan): boolean {
        if (!diagnostic.file) {
            return false;
        }

        // Check if file is mentioned in plan
        const filePath = diagnostic.file.toLowerCase();
        
        // Check in file changes
        if (plan.fileChanges) {
            for (const change of plan.fileChanges) {
                if (change.file.toLowerCase().includes(filePath) || filePath.includes(change.file.toLowerCase())) {
                    return true;
                }
            }
        }

        // Check in code snippets
        if (plan.codeSnippets) {
            for (const snippet of plan.codeSnippets) {
                if (snippet.file && (snippet.file.toLowerCase().includes(filePath) || filePath.includes(snippet.file.toLowerCase()))) {
                    return true;
                }
            }
        }

        // Check if diagnostic mentions symbols from plan
        if (diagnostic.symbol) {
            const symbolName = diagnostic.symbol.toLowerCase();
            if (plan.codeSnippets) {
                for (const snippet of plan.codeSnippets) {
                    if (snippet.symbols) {
                        for (const symbol of snippet.symbols) {
                            if (symbol.name.toLowerCase() === symbolName) {
                                return true;
                            }
                        }
                    }
                }
            }
        }

        return false;
    }

    /**
     * Get suggestion for UHT diagnostic
     */
    private getUHTSuggestion(diagnostic: any): string | undefined {
        const message = (diagnostic.message || '').toLowerCase();
        
        if (message.includes('missing')) {
            return 'Add the missing declaration or include';
        } else if (message.includes('macro')) {
            return 'Check UCLASS, USTRUCT, UENUM, UFUNCTION, or UPROPERTY macro usage';
        } else if (message.includes('generated')) {
            return 'Ensure the class is properly marked for code generation';
        } else if (message.includes('include')) {
            return 'Add the required include file';
        }

        return undefined;
    }

    /**
     * Validate a code snippet for common issues
     */
    private validateCodeSnippet(snippet: CodeSnippet): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (snippet.language === 'cpp' || snippet.language === 'c++' || snippet.language === 'h' || snippet.language === 'hpp') {
            const code = snippet.code;

            // Check for missing includes
            if (code.includes('UCLASS') && !code.includes('#include "CoreMinimal.h"') && !code.includes('#include <CoreMinimal.h>')) {
                issues.push({
                    type: 'intellisense',
                    severity: 'warning',
                    message: 'Missing CoreMinimal.h include for UCLASS',
                    location: { file: snippet.file },
                    suggestion: 'Add #include "CoreMinimal.h" at the top of the file'
                });
            }

            // Check for missing UCLASS macro on classes
            const classMatch = code.match(/class\s+[A-Z_]+\s+API\s+(\w+)/);
            if (classMatch && !code.includes('UCLASS')) {
                issues.push({
                    type: 'intellisense',
                    severity: 'error',
                    message: `Class '${classMatch[1]}' is missing UCLASS() macro`,
                    location: { file: snippet.file },
                    suggestion: 'Add UCLASS() macro before the class declaration'
                });
            }

            // Check for missing UFUNCTION macro on Blueprint-exposed functions
            const blueprintCallableMatch = code.match(/BlueprintCallable/i);
            if (blueprintCallableMatch && !code.includes('UFUNCTION')) {
                issues.push({
                    type: 'intellisense',
                    severity: 'error',
                    message: 'BlueprintCallable function missing UFUNCTION() macro',
                    location: { file: snippet.file },
                    suggestion: 'Add UFUNCTION(BlueprintCallable) macro before the function declaration'
                });
            }
        }

        return issues;
    }
}

