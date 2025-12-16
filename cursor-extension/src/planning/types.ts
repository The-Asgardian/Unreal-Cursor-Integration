/**
 * Type definitions for the Planning Validation System
 */

export interface Plan {
    name: string;
    overview: string;
    todos: PlanTodo[];
    fileChanges?: FileChange[];
    codeSnippets?: CodeSnippet[];
    metadata?: PlanMetadata;
}

export interface PlanTodo {
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    dependencies?: string[];
}

export interface FileChange {
    file: string;
    operation: 'create' | 'modify' | 'delete';
    content?: string;
    lineRange?: { start: number; end: number };
}

export interface CodeSnippet {
    file: string;
    language: string;
    code: string;
    lineRange?: { start: number; end: number };
    symbols?: ExtractedSymbol[];
}

export interface ExtractedSymbol {
    type: 'class' | 'function' | 'property' | 'enum' | 'struct';
    name: string;
    namespace?: string;
    location?: {
        file: string;
        line: number;
    };
}

export interface PlanMetadata {
    createdAt?: string;
    modifiedAt?: string;
    version?: string;
}

export interface ValidationResult {
    valid: boolean;
    iterations: number;
    issues: ValidationIssue[];
    refinedPlan?: Plan;
    warnings: string[];
    skippedValidations?: string[];
}

export interface ValidationIssue {
    type: 'reflection' | 'intellisense' | 'api' | 'design';
    severity: 'error' | 'warning' | 'info';
    message: string;
    location?: {
        file?: string;
        line?: number;
        symbol?: string;
    };
    suggestion?: string;
    fixed?: boolean;
    originalCode?: string;
    suggestedCode?: string;
}

export interface ValidationContext {
    connectionState?: {
        connected: boolean;
        projectInfo?: {
            engineVersion: string;
            projectName: string;
        };
    };
    compileCommandsPath?: string;
    reflectionCache?: Map<string, any>;
}

export interface RefinementResult {
    plan: Plan;
    changes: RefinementChange[];
    issuesFixed: number;
    issuesRemaining: number;
}

export interface RefinementChange {
    type: 'add' | 'modify' | 'remove';
    target: 'todo' | 'file' | 'code';
    description: string;
    before?: string;
    after?: string;
}

