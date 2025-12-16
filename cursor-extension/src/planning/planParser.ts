import { Plan, PlanTodo, FileChange, CodeSnippet, ExtractedSymbol } from './types';

/**
 * Parser for extracting plan information from markdown or JSON format
 */
export class PlanParser {
    /**
     * Parse plan from markdown format (Cursor planning mode format)
     */
    static parseMarkdown(content: string): Plan {
        const lines = content.split('\n');
        const plan: Plan = {
            name: '',
            overview: '',
            todos: [],
            fileChanges: [],
            codeSnippets: []
        };

        let currentSection: 'header' | 'overview' | 'todos' | 'code' | null = null;
        let currentCodeBlock: { language?: string; code: string[]; file?: string } | null = null;
        let todoIdCounter = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Parse frontmatter
            if (trimmed.startsWith('---')) {
                const frontmatterEnd = lines.findIndex((l, idx) => idx > i && l.trim().startsWith('---'));
                if (frontmatterEnd > i) {
                    const frontmatter = lines.slice(i + 1, frontmatterEnd).join('\n');
                    this.parseFrontmatter(frontmatter, plan);
                    i = frontmatterEnd;
                    continue;
                }
            }

            // Parse name
            if (trimmed.startsWith('# ')) {
                plan.name = trimmed.substring(2).trim();
                currentSection = 'header';
                continue;
            }

            // Parse overview
            if (trimmed.toLowerCase().startsWith('## overview') || trimmed.toLowerCase().startsWith('## summary')) {
                currentSection = 'overview';
                continue;
            }

            // Parse todos
            if (trimmed.toLowerCase().startsWith('## todo') || trimmed.toLowerCase().startsWith('## todos')) {
                currentSection = 'todos';
                continue;
            }

            // Parse code blocks
            if (trimmed.startsWith('```')) {
                if (currentCodeBlock) {
                    // End of code block
                    const code = currentCodeBlock.code.join('\n');
                    const symbols = this.extractSymbols(code, currentCodeBlock.language || 'cpp');
                    
                    if (plan.codeSnippets) {
                        plan.codeSnippets.push({
                            file: currentCodeBlock.file || '',
                            language: currentCodeBlock.language || 'cpp',
                            code: code,
                            symbols: symbols
                        });
                    }
                    currentCodeBlock = null;
                } else {
                    // Start of code block
                    const language = trimmed.substring(3).trim();
                    const fileMatch = language.match(/^(\w+):(.+)$/);
                    currentCodeBlock = {
                        language: fileMatch ? fileMatch[1] : language,
                        code: [],
                        file: fileMatch ? fileMatch[2].trim() : undefined
                    };
                }
                continue;
            }

            // Process content based on current section
            if (currentCodeBlock) {
                currentCodeBlock.code.push(line);
            } else if (currentSection === 'overview') {
                if (trimmed && !trimmed.startsWith('#')) {
                    plan.overview += (plan.overview ? '\n' : '') + trimmed;
                }
            } else if (currentSection === 'todos') {
                const todo = this.parseTodoLine(trimmed, todoIdCounter++);
                if (todo) {
                    plan.todos.push(todo);
                }
            }
        }

        // Handle any remaining code block
        if (currentCodeBlock) {
            const code = currentCodeBlock.code.join('\n');
            const symbols = this.extractSymbols(code, currentCodeBlock.language || 'cpp');
            
            if (plan.codeSnippets) {
                plan.codeSnippets.push({
                    file: currentCodeBlock.file || '',
                    language: currentCodeBlock.language || 'cpp',
                    code: code,
                    symbols: symbols
                });
            }
        }

        return plan;
    }

    /**
     * Parse plan from JSON format
     */
    static parseJSON(content: string): Plan {
        try {
            const parsed = JSON.parse(content);
            return {
                name: parsed.name || '',
                overview: parsed.overview || '',
                todos: parsed.todos || [],
                fileChanges: parsed.fileChanges || [],
                codeSnippets: parsed.codeSnippets || [],
                metadata: parsed.metadata
            };
        } catch (error) {
            throw new Error(`Failed to parse plan JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Parse frontmatter section
     */
    private static parseFrontmatter(content: string, plan: Plan): void {
        const lines = content.split('\n');
        for (const line of lines) {
            const match = line.match(/^(\w+):\s*(.+)$/);
            if (match) {
                const key = match[1].trim();
                const value = match[2].trim();
                
                if (key === 'name') {
                    plan.name = value;
                } else if (key === 'overview') {
                    plan.overview = value;
                }
            }
        }
    }

    /**
     * Parse a todo line from markdown
     */
    private static parseTodoLine(line: string, defaultId: number): PlanTodo | null {
        // Match patterns like:
        // - [ ] Task description
        // - [x] Completed task
        // - [in_progress] Task in progress
        const todoMatch = line.match(/^[-*]\s*\[([ x]|pending|in_progress|completed|cancelled)\]\s*(.+)$/i);
        if (todoMatch) {
            const statusStr = todoMatch[1].toLowerCase();
            const content = todoMatch[2].trim();
            
            let status: PlanTodo['status'] = 'pending';
            if (statusStr === 'x' || statusStr === 'completed') {
                status = 'completed';
            } else if (statusStr === 'in_progress') {
                status = 'in_progress';
            } else if (statusStr === 'cancelled') {
                status = 'cancelled';
            }

            // Extract ID if present (e.g., "id: todo-1")
            const idMatch = content.match(/^id:\s*(\w+)\s+(.+)$/i);
            const id = idMatch ? idMatch[1] : `todo-${defaultId}`;
            const todoContent = idMatch ? idMatch[2] : content;

            // Extract dependencies if present
            const depsMatch = todoContent.match(/dependencies:\s*\[([^\]]+)\]/i);
            const dependencies = depsMatch 
                ? depsMatch[1].split(',').map(d => d.trim())
                : undefined;

            return {
                id,
                content: todoContent.replace(/dependencies:\s*\[[^\]]+\]/gi, '').trim(),
                status,
                dependencies
            };
        }

        // Match numbered list items
        const numberedMatch = line.match(/^\d+\.\s*(.+)$/);
        if (numberedMatch) {
            return {
                id: `todo-${defaultId}`,
                content: numberedMatch[1].trim(),
                status: 'pending'
            };
        }

        return null;
    }

    /**
     * Extract symbols (classes, functions, properties) from code
     */
    private static extractSymbols(code: string, language: string): ExtractedSymbol[] {
        const symbols: ExtractedSymbol[] = [];

        if (language === 'cpp' || language === 'c++' || language === 'h' || language === 'hpp') {
            // Extract class names
            const classRegex = /(?:UCLASS|class)\s+(?:[A-Z_]+\s+)?(\w+)(?:\s*:\s*public\s+(\w+))?/g;
            let match: RegExpExecArray | null;
            while ((match = classRegex.exec(code)) !== null) {
                symbols.push({
                    type: 'class',
                    name: match[1],
                    namespace: undefined,
                    location: { file: '', line: this.getLineNumber(code, match.index) }
                });
            }

            // Extract function declarations
            const functionRegex = /(?:UFUNCTION|virtual\s+)?(?:static\s+)?(?:inline\s+)?(?:const\s+)?\w+\s+(\w+)\s*\(/g;
            while ((match = functionRegex.exec(code)) !== null) {
                // Skip if it's a class name
                if (!symbols.some(s => s.type === 'class' && s.name === match![1])) {
                    symbols.push({
                        type: 'function',
                        name: match[1],
                        namespace: undefined,
                        location: { file: '', line: this.getLineNumber(code, match.index) }
                    });
                }
            }

            // Extract properties
            const propertyRegex = /UPROPERTY\s*\([^)]*\)\s+(?:[A-Z_]+\s+)?(\w+)\s*[;=]/g;
            while ((match = propertyRegex.exec(code)) !== null) {
                symbols.push({
                    type: 'property',
                    name: match[1],
                    namespace: undefined,
                    location: { file: '', line: this.getLineNumber(code, match.index) }
                });
            }
        }

        return symbols;
    }

    /**
     * Get line number from character index
     */
    private static getLineNumber(text: string, index: number): number {
        return text.substring(0, index).split('\n').length - 1;
    }
}

