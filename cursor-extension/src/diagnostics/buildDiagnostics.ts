import * as vscode from 'vscode';
import { EventMessage } from '../ipc/protocol';

export class BuildDiagnostics {
    private diagnosticCollection: vscode.DiagnosticCollection;

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('unreal-build');
    }

    clear(): void {
        this.diagnosticCollection.clear();
    }

    processBuildDiagnostic(event: EventMessage): void {
        if (event.event === 'build.diagnostic' && event.data) {
            const diagnostic = this.parseDiagnostic(event.data);
            if (diagnostic) {
                const uri = vscode.Uri.file(diagnostic.file);
                const existing = this.diagnosticCollection.get(uri) || [];
                this.diagnosticCollection.set(uri, [...existing, diagnostic.diagnostic]);
            }
        }
    }

    private parseDiagnostic(data: any): { file: string; diagnostic: vscode.Diagnostic } | null {
        if (!data.file || !data.message) {
            return null;
        }

        const severity = this.mapSeverity(data.severity || 'error');
        const line = Math.max(0, (data.line || 1) - 1);
        const column = Math.max(0, (data.column || 1) - 1);

        const range = new vscode.Range(
            line,
            column,
            line,
            column + 100 // Default range length
        );

        const diagnostic = new vscode.Diagnostic(range, data.message, severity);
        diagnostic.source = 'Unreal Build';

        return {
            file: data.file,
            diagnostic
        };
    }

    private mapSeverity(severity: string): vscode.DiagnosticSeverity {
        switch (severity.toLowerCase()) {
            case 'error':
                return vscode.DiagnosticSeverity.Error;
            case 'warning':
                return vscode.DiagnosticSeverity.Warning;
            case 'info':
                return vscode.DiagnosticSeverity.Information;
            default:
                return vscode.DiagnosticSeverity.Error;
        }
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
    }
}

