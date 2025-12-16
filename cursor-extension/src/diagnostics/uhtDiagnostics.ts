import * as vscode from 'vscode';
import * as path from 'path';

export interface UHTDiagnostic {
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning' | 'info';
    message: string;
    jobId: string;
}

export class UHTDiagnosticsManager {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private diagnosticsByJob: Map<string, UHTDiagnostic[]> = new Map();

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('unreal-uht');
    }

    /**
     * Parse UHT error/warning line and extract file, line, column information
     * Examples:
     *   "C:/Project/Source/MyClass.cpp(123): Error: Missing UCLASS() macro"
     *   "MyClass.h(45,12): Warning: Invalid metadata"
     */
    private parseDiagnosticLine(line: string, jobId: string): UHTDiagnostic | null {
        // Pattern 1: File(Line): Severity: Message
        // Pattern 2: File(Line,Column): Severity: Message
        const pattern1 = /^(.+?)\((\d+)\):\s*(Error|Warning|error|warning):\s*(.+)$/i;
        const pattern2 = /^(.+?)\((\d+),(\d+)\):\s*(Error|Warning|error|warning):\s*(.+)$/i;
        
        let match = line.match(pattern2);
        if (match) {
            const file = match[1].trim();
            const lineNum = parseInt(match[2], 10);
            const colNum = parseInt(match[3], 10);
            const severity = match[4].toLowerCase() === 'error' ? 'error' : 'warning';
            const message = match[5].trim();
            
            return {
                file: this.normalizePath(file),
                line: lineNum,
                column: colNum,
                severity,
                message,
                jobId
            };
        }
        
        match = line.match(pattern1);
        if (match) {
            const file = match[1].trim();
            const lineNum = parseInt(match[2], 10);
            const severity = match[3].toLowerCase() === 'error' ? 'error' : 'warning';
            const message = match[4].trim();
            
            return {
                file: this.normalizePath(file),
                line: lineNum,
                column: 0,
                severity,
                message,
                jobId
            };
        }
        
        // Pattern 3: Just check if line contains error/warning keywords
        const lowerLine = line.toLowerCase();
        if (lowerLine.includes('error:') || lowerLine.includes('warning:')) {
            // Try to extract file path from common patterns
            const filePattern = /([A-Za-z]:[\\/][^\s]+\.(cpp|h|hpp|c))|([^\s]+\.(cpp|h|hpp|c))/;
            const fileMatch = line.match(filePattern);
            const file = fileMatch ? fileMatch[0] : 'unknown';
            
            // Try to extract line number
            const linePattern = /\((\d+)\)/;
            const lineMatch = line.match(linePattern);
            const lineNum = lineMatch ? parseInt(lineMatch[1], 10) : 0;
            
            const severity = lowerLine.includes('error:') ? 'error' : 'warning';
            const message = line.trim();
            
            return {
                file: this.normalizePath(file),
                line: lineNum,
                column: 0,
                severity,
                message,
                jobId
            };
        }
        
        return null;
    }

    private normalizePath(filePath: string): string {
        // Normalize Windows paths and make them absolute if relative
        let normalized = filePath.replace(/\\/g, '/');
        
        // If it's a relative path, try to resolve it
        if (!path.isAbsolute(normalized) && normalized !== 'unknown') {
            // Try to find the file in workspace
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                for (const folder of workspaceFolders) {
                    const fullPath = path.join(folder.uri.fsPath, normalized);
                    if (vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fullPath))) {
                        return fullPath;
                    }
                }
            }
        }
        
        return normalized;
    }

    addDiagnosticsFromOutput(output: string, jobId: string): void {
        const lines = output.split('\n');
        const diagnostics: UHTDiagnostic[] = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            const diagnostic = this.parseDiagnosticLine(trimmed, jobId);
            if (diagnostic) {
                diagnostics.push(diagnostic);
            }
        }
        
        if (diagnostics.length > 0) {
            this.diagnosticsByJob.set(jobId, diagnostics);
            this.updateDiagnostics();
        }
    }

    addDiagnostic(diagnostic: UHTDiagnostic): void {
        const jobDiagnostics = this.diagnosticsByJob.get(diagnostic.jobId) || [];
        jobDiagnostics.push(diagnostic);
        this.diagnosticsByJob.set(diagnostic.jobId, jobDiagnostics);
        this.updateDiagnostics();
    }

    clearJobDiagnostics(jobId: string): void {
        this.diagnosticsByJob.delete(jobId);
        this.updateDiagnostics();
    }

    clearAllDiagnostics(): void {
        this.diagnosticsByJob.clear();
        this.diagnosticCollection.clear();
    }

    private updateDiagnostics(): void {
        // Group diagnostics by file
        const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>();

        for (const diagnostics of this.diagnosticsByJob.values()) {
            for (const diag of diagnostics) {
                const uri = vscode.Uri.file(diag.file);
                const fileDiags = diagnosticsByFile.get(diag.file) || [];
                
                const severity = diag.severity === 'error' ? vscode.DiagnosticSeverity.Error :
                                 diag.severity === 'warning' ? vscode.DiagnosticSeverity.Warning :
                                 vscode.DiagnosticSeverity.Information;
                
                const vscodeDiag = new vscode.Diagnostic(
                    new vscode.Range(
                        Math.max(0, diag.line - 1),
                        Math.max(0, diag.column - 1),
                        Math.max(0, diag.line - 1),
                        Math.max(0, diag.column)
                    ),
                    diag.message,
                    severity
                );
                vscodeDiag.source = 'Unreal UHT';
                
                fileDiags.push(vscodeDiag);
                diagnosticsByFile.set(diag.file, fileDiags);
            }
        }

        // Update diagnostic collection
        this.diagnosticCollection.clear();
        for (const [file, diags] of diagnosticsByFile) {
            try {
                const uri = vscode.Uri.file(file);
                this.diagnosticCollection.set(uri, diags);
            } catch (error) {
                // Skip invalid file paths
                console.warn(`Failed to set diagnostics for file: ${file}`, error);
            }
        }
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
    }
}

