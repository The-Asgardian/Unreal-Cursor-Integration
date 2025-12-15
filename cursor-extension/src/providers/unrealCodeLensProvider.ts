import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

export class UnrealCodeLensProvider implements vscode.CodeLensProvider {
    private connectionManager: ConnectionManager;
    private connectionState: ConnectionState;
    private onDidChangeCodeLensesEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();

    public readonly onDidChangeCodeLenses: vscode.Event<void> = this.onDidChangeCodeLensesEmitter.event;

    constructor(
        connectionManager: ConnectionManager,
        connectionState: ConnectionState
    ) {
        this.connectionManager = connectionManager;
        this.connectionState = connectionState;
    }

    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        if (!this.connectionState.connected || document.languageId !== 'cpp') {
            return [];
        }

        const codeLenses: vscode.CodeLens[] = [];

        try {
            const text = document.getText();

            // Find UPROPERTY declarations
            const propertyRegex = /UPROPERTY\s*\([^)]*\)\s+[^\s]+\s+(\w+)\s*;/g;
            let propertyMatch;
            while ((propertyMatch = propertyRegex.exec(text)) !== null) {
                const propertyName = propertyMatch[1];
                const matchIndex = propertyMatch.index || 0;
                const lineNumber = text.substring(0, matchIndex).split('\n').length - 1;
                const line = document.lineAt(lineNumber);

                try {
                    // Try to find property in reflection
                    const symbolResult = await this.connectionManager.sendRequest('reflection.findSymbol', {
                        symbolName: propertyName
                    });

                    if (symbolResult && symbolResult.symbolType === 'property') {
                        const range = new vscode.Range(lineNumber, 0, lineNumber, line.text.length);
                        
                        // Add badges
                        const badges: string[] = [];
                        if (symbolResult.replication && symbolResult.replication.enabled) {
                            badges.push('🔄 Replicated');
                        }
                        if (symbolResult.flags && (symbolResult.flags as string[]).includes('BlueprintReadWrite')) {
                            badges.push('🔵 Blueprint');
                        }

                        if (badges.length > 0) {
                            codeLenses.push({
                                range,
                                isResolved: true,
                                command: {
                                    title: badges.join(' • '),
                                    command: ''
                                }
                            });
                        }
                    }
                } catch (error) {
                    // Ignore errors
                }
            }

            // Find UFUNCTION declarations
            const functionRegex = /UFUNCTION\s*\([^)]*\)\s+[^\s]+\s+(\w+)\s*\(/g;
            let functionMatch;
            while ((functionMatch = functionRegex.exec(text)) !== null) {
                const functionName = functionMatch[1];
                const matchIndex = functionMatch.index || 0;
                const lineNumber = text.substring(0, matchIndex).split('\n').length - 1;
                const line = document.lineAt(lineNumber);

                try {
                    // Try to find function in reflection
                    const symbolResult = await this.connectionManager.sendRequest('reflection.findSymbol', {
                        symbolName: functionName
                    });

                    if (symbolResult && symbolResult.symbolType === 'function') {
                        const range = new vscode.Range(lineNumber, 0, lineNumber, line.text.length);
                        
                        // Add badges
                        const badges: string[] = [];
                        if (symbolResult.flags && (symbolResult.flags as string[]).includes('BlueprintCallable')) {
                            badges.push('🔵 BlueprintCallable');
                        }
                        if (symbolResult.net && symbolResult.net.rpc) {
                            badges.push(`📡 ${symbolResult.net.rpc} RPC`);
                        }

                        if (badges.length > 0) {
                            codeLenses.push({
                                range,
                                isResolved: true,
                                command: {
                                    title: badges.join(' • '),
                                    command: ''
                                }
                            });
                        }
                    }
                } catch (error) {
                    // Ignore errors
                }
            }
        } catch (error) {
            // Ignore errors
        }

        return codeLenses;
    }
}

