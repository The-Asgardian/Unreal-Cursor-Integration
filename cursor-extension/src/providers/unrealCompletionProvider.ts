import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

export class UnrealCompletionProvider implements vscode.CompletionItemProvider {
    constructor(
        private connectionManager: ConnectionManager,
        private connectionState: ConnectionState
    ) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | vscode.CompletionList | null> {
        if (!this.connectionState.connected) {
            return null;
        }

        // This provider augments clangd completions by re-ranking them
        // We don't provide our own completions, but we can enhance existing ones
        // For now, return null to let clangd handle completions
        // In a full implementation, we would intercept clangd completions and re-rank them
        
        return null;
    }

    async resolveCompletionItem(
        item: vscode.CompletionItem,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem> {
        if (!this.connectionState.connected || !item.label) {
            return item;
        }

        try {
            // Try to find the symbol in reflection
            const symbolName = typeof item.label === 'string' ? item.label : item.label.label;
            const symbolResult = await this.connectionManager.sendRequest('reflection.findSymbol', {
                symbolName: symbolName
            });

            if (symbolResult) {
                // Add metadata badges to the completion item
                const details: string[] = [];

                if (symbolResult.flags) {
                    const flags = symbolResult.flags as string[];
                    if (flags.includes('BlueprintCallable') || flags.includes('BlueprintEvent')) {
                        details.push('🔵 Blueprint');
                    }
                    if (flags.includes('Replicated')) {
                        details.push('🔄 Replicated');
                    }
                    if (symbolResult.net && symbolResult.net.rpc) {
                        details.push(`📡 ${symbolResult.net.rpc} RPC`);
                    }
                }

                if (details.length > 0) {
                    item.detail = details.join(' • ');
                }

                // Add documentation from metadata
                if (symbolResult.metadata) {
                    const docParts: string[] = [];
                    for (const [key, value] of Object.entries(symbolResult.metadata)) {
                        if (key === 'Tooltip' || key === 'Comment') {
                            docParts.push(value as string);
                        }
                    }
                    if (docParts.length > 0) {
                        item.documentation = new vscode.MarkdownString(docParts.join('\n\n'));
                    }
                }
            }
        } catch (error) {
            // Ignore errors
        }

        return item;
    }
}

