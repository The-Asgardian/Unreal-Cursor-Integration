import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

export class UnrealDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private connectionManager: ConnectionManager;
    private connectionState: ConnectionState;

    constructor(
        connectionManager: ConnectionManager,
        connectionState: ConnectionState
    ) {
        this.connectionManager = connectionManager;
        this.connectionState = connectionState;
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('unreal-intellisense');
    }

    async validateDocument(document: vscode.TextDocument): Promise<void> {
        if (!this.connectionState.connected || document.languageId !== 'cpp') {
            this.diagnosticCollection.delete(document.uri);
            return;
        }

        const diagnostics: vscode.Diagnostic[] = [];

        try {
            // Get all classes in the document
            const text = document.getText();
            const classRegex = /UCLASS\s*\([^)]*\)\s*class\s+[A-Z_]+_API\s+(\w+)/g;
            const classMatches = Array.from(text.matchAll(classRegex));

            for (const match of classMatches) {
                const className = match[1];
                const matchIndex = match.index || 0;
                const lineNumber = text.substring(0, matchIndex).split('\n').length - 1;
                const line = document.lineAt(lineNumber);

                // Get class metadata from reflection
                try {
                    const classResult = await this.connectionManager.sendRequest('reflection.getClass', {
                        className: className
                    });

                    if (classResult) {
                        // Get functions for this class
                        const functionsResult = await this.connectionManager.sendRequest('reflection.getFunctions', {
                            className: className
                        });

                        if (functionsResult && functionsResult.functions) {
                            for (const func of functionsResult.functions) {
                                // Check: BlueprintCallable but non-const function mutating state
                                if (func.flags && func.flags.includes('BlueprintCallable')) {
                                    // Find the function in the document
                                    const funcRegex = new RegExp(`UFUNCTION\\s*\\([^)]*\\)\\s+[^\\s]+\\s+${func.name}\\s*\\(`, 'g');
                                    const funcMatches = Array.from(text.matchAll(funcRegex));
                                    
                                    for (const funcMatch of funcMatches) {
                                        const funcIndex = funcMatch.index || 0;
                                        const funcLineNumber = text.substring(0, funcIndex).split('\n').length - 1;
                                        const funcLine = document.lineAt(funcLineNumber);
                                        
                                        // Check if function is const (simplified check)
                                        if (!funcLine.text.includes('const')) {
                                            const range = new vscode.Range(
                                                funcLineNumber,
                                                0,
                                                funcLineNumber,
                                                funcLine.text.length
                                            );
                                            diagnostics.push({
                                                range,
                                                message: `Function ${func.name} is BlueprintCallable but not const. Consider making it const if it doesn't mutate state.`,
                                                severity: vscode.DiagnosticSeverity.Warning,
                                                source: 'Unreal IntelliSense'
                                            });
                                        }
                                    }
                                }

                                // Check: UFUNCTION(Server) called from client-only context
                                if (func.net && func.net.rpc === 'Server') {
                                    // This is a simplified check - in reality, we'd need to analyze call sites
                                    // For now, we just note that Server RPCs exist
                                }
                            }
                        }

                        // Get properties for this class
                        const propertiesResult = await this.connectionManager.sendRequest('reflection.getProperties', {
                            className: className
                        });

                        if (propertiesResult && propertiesResult.properties) {
                            for (const prop of propertiesResult.properties) {
                                // Check: Replicated property without OnRep function
                                if (prop.replication && prop.replication.enabled) {
                                    const onRepName = `OnRep_${prop.name}`;
                                    const hasOnRep = functionsResult && functionsResult.functions && 
                                        functionsResult.functions.some((f: any) => f.name === onRepName);
                                    
                                    if (!hasOnRep && prop.replication.condition !== 'None') {
                                        // Find the property in the document
                                        const propRegex = new RegExp(`UPROPERTY\\s*\\([^)]*\\)\\s+[^\\s]+\\s+${prop.name}\\s*;`, 'g');
                                        const propMatches = Array.from(text.matchAll(propRegex));
                                        
                                        for (const propMatch of propMatches) {
                                            const propIndex = propMatch.index || 0;
                                            const propLineNumber = text.substring(0, propIndex).split('\n').length - 1;
                                            const propLine = document.lineAt(propLineNumber);
                                            
                                            const range = new vscode.Range(
                                                propLineNumber,
                                                0,
                                                propLineNumber,
                                                propLine.text.length
                                            );
                                            diagnostics.push({
                                                range,
                                                message: `Replicated property ${prop.name} should have an OnRep function: ${onRepName}`,
                                                severity: vscode.DiagnosticSeverity.Warning,
                                                source: 'Unreal IntelliSense'
                                            });
                                        }
                                    }
                                }

                                // Check: Missing UPROPERTY() on Blueprint-exposed properties
                                // This is harder to detect without parsing, so we skip it for now
                            }
                        }
                    }
                } catch (error) {
                    // Ignore errors - class might not be loaded yet
                }
            }
        } catch (error) {
            // Ignore errors
        }

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
    }
}

