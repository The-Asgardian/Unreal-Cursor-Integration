import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

export class UnrealInlayHintsProvider implements vscode.InlayHintsProvider {
    constructor(
        private connectionManager: ConnectionManager,
        private connectionState: ConnectionState
    ) {}

    async provideInlayHints(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken
    ): Promise<vscode.InlayHint[]> {
        if (!this.connectionState.connected || document.languageId !== 'cpp') {
            return [];
        }

        const hints: vscode.InlayHint[] = [];

        try {
            const text = document.getText(range);

            // Find UPROPERTY declarations in range
            const propertyRegex = /UPROPERTY\s*\([^)]*\)\s+[^\s]+\s+(\w+)\s*;/g;
            let propertyMatch;
            while ((propertyMatch = propertyRegex.exec(text)) !== null) {
                const propertyName = propertyMatch[1];
                const matchIndex = propertyMatch.index || 0;
                const relativeLineNumber = text.substring(0, matchIndex).split('\n').length - 1;
                const absoluteLineNumber = range.start.line + relativeLineNumber;
                const line = document.lineAt(absoluteLineNumber);
                const propertyEndPos = line.text.indexOf(propertyName) + propertyName.length;

                try {
                    const symbolResult = await this.connectionManager.sendRequest('reflection.findSymbol', {
                        symbolName: propertyName
                    });

                    if (symbolResult && symbolResult.symbolType === 'property') {
                        const position = new vscode.Position(absoluteLineNumber, propertyEndPos);
                        
                        if (symbolResult.replication && symbolResult.replication.enabled) {
                            hints.push({
                                position,
                                label: '[Replicated]',
                                kind: vscode.InlayHintKind.Parameter,
                                paddingLeft: true
                            });
                        }
                        if (symbolResult.flags && (symbolResult.flags as string[]).includes('BlueprintReadWrite')) {
                            hints.push({
                                position,
                                label: '[Blueprint]',
                                kind: vscode.InlayHintKind.Parameter,
                                paddingLeft: true
                            });
                        }
                    }
                } catch (error) {
                    // Ignore errors
                }
            }

            // Find UFUNCTION declarations in range
            const functionRegex = /UFUNCTION\s*\([^)]*\)\s+[^\s]+\s+(\w+)\s*\(/g;
            let functionMatch;
            while ((functionMatch = functionRegex.exec(text)) !== null) {
                const functionName = functionMatch[1];
                const matchIndex = functionMatch.index || 0;
                const relativeLineNumber = text.substring(0, matchIndex).split('\n').length - 1;
                const absoluteLineNumber = range.start.line + relativeLineNumber;
                const line = document.lineAt(absoluteLineNumber);
                const functionEndPos = line.text.indexOf(functionName) + functionName.length;

                try {
                    const symbolResult = await this.connectionManager.sendRequest('reflection.findSymbol', {
                        symbolName: functionName
                    });

                    if (symbolResult && symbolResult.symbolType === 'function') {
                        const position = new vscode.Position(absoluteLineNumber, functionEndPos);
                        
                        if (symbolResult.flags && (symbolResult.flags as string[]).includes('BlueprintCallable')) {
                            hints.push({
                                position,
                                label: '[BlueprintCallable]',
                                kind: vscode.InlayHintKind.Parameter,
                                paddingLeft: true
                            });
                        }
                        if (symbolResult.net && symbolResult.net.rpc) {
                            hints.push({
                                position,
                                label: `[${symbolResult.net.rpc} RPC]`,
                                kind: vscode.InlayHintKind.Parameter,
                                paddingLeft: true
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

        return hints;
    }
}

