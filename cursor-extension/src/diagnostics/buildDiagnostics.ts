import * as vscode from 'vscode';

export interface BuildDiagnostic {
    file: string;
    line: number;
    column: number;
    severity: 'error' | 'warning' | 'info';
    message: string;
    buildId: string;
}

export class BuildDiagnosticsManager {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private diagnosticsByBuild: Map<string, BuildDiagnostic[]> = new Map();

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('unreal-build');
    }

    addDiagnostic(diagnostic: BuildDiagnostic): void {
        const buildDiagnostics = this.diagnosticsByBuild.get(diagnostic.buildId) || [];
        buildDiagnostics.push(diagnostic);
        this.diagnosticsByBuild.set(diagnostic.buildId, buildDiagnostics);
        
        this.updateDiagnostics();
    }

    clearBuildDiagnostics(buildId: string): void {
        this.diagnosticsByBuild.delete(buildId);
        this.updateDiagnostics();
    }

    clearAllDiagnostics(): void {
        this.diagnosticsByBuild.clear();
        this.diagnosticCollection.clear();
    }

    private updateDiagnostics(): void {
        // Group diagnostics by file
        const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>();

        for (const diagnostics of this.diagnosticsByBuild.values()) {
            for (const diag of diagnostics) {
                const uri = vscode.Uri.file(diag.file);
                const fileDiags = diagnosticsByFile.get(diag.file) || [];
                
                const severity = diag.severity === 'error' ? vscode.DiagnosticSeverity.Error :
                                 diag.severity === 'warning' ? vscode.DiagnosticSeverity.Warning :
                                 vscode.DiagnosticSeverity.Information;
                
                const vscodeDiag = new vscode.Diagnostic(
                    new vscode.Range(
                        diag.line - 1,
                        diag.column - 1,
                        diag.line - 1,
                        diag.column - 1
                    ),
                    diag.message,
                    severity
                );
                
                fileDiags.push(vscodeDiag);
                diagnosticsByFile.set(diag.file, fileDiags);
            }
        }

        // Update diagnostic collection
        this.diagnosticCollection.clear();
        for (const [file, diags] of diagnosticsByFile) {
            this.diagnosticCollection.set(vscode.Uri.file(file), diags);
        }
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
