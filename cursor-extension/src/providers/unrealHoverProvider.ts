import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

export class UnrealHoverProvider implements vscode.HoverProvider {
    constructor(
        private connectionManager: ConnectionManager,
        private connectionState: ConnectionState
    ) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | null> {
        if (!this.connectionState.connected) {
            return null;
        }

        // Get the word at the cursor position
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        const symbolName = document.getText(wordRange);
        if (!symbolName) {
            return null;
        }

        try {
            // Try to find the symbol in reflection
            const symbolResult = await this.connectionManager.sendRequest('reflection.findSymbol', {
                symbolName: symbolName
            });

            if (!symbolResult) {
                return null;
            }

            const symbolType = symbolResult.symbolType || 'class';
            const contents: vscode.MarkdownString[] = [];

            // Add basic info
            const name = symbolResult.name || symbolName;
            const fullName = symbolResult.fullName || name;
            contents.push(new vscode.MarkdownString(`**${name}**\n\`${fullName}\``));

            // Add class-specific info
            if (symbolType === 'class' || !symbolType) {
                if (symbolResult.super) {
                    contents.push(new vscode.MarkdownString(`**Super:** ${symbolResult.super}`));
                }
                if (symbolResult.module) {
                    contents.push(new vscode.MarkdownString(`**Module:** ${symbolResult.module}`));
                }
            }

            // Add function-specific info
            if (symbolType === 'function') {
                if (symbolResult.returnType) {
                    contents.push(new vscode.MarkdownString(`**Returns:** \`${symbolResult.returnType}\``));
                }
                if (symbolResult.flags && symbolResult.flags.length > 0) {
                    const flags = symbolResult.flags.join(', ');
                    contents.push(new vscode.MarkdownString(`**Flags:** ${flags}`));
                }
                if (symbolResult.net) {
                    const rpc = symbolResult.net.rpc || 'Unknown';
                    const reliable = symbolResult.net.reliable ? 'Reliable' : 'Unreliable';
                    contents.push(new vscode.MarkdownString(`**RPC:** ${rpc} (${reliable})`));
                }
                if (symbolResult.className) {
                    contents.push(new vscode.MarkdownString(`**Class:** ${symbolResult.className}`));
                }
            }

            // Add property-specific info
            if (symbolType === 'property') {
                if (symbolResult.cppType) {
                    contents.push(new vscode.MarkdownString(`**Type:** \`${symbolResult.cppType}\``));
                }
                if (symbolResult.flags && symbolResult.flags.length > 0) {
                    const flags = symbolResult.flags.join(', ');
                    contents.push(new vscode.MarkdownString(`**Flags:** ${flags}`));
                }
                if (symbolResult.replication && symbolResult.replication.enabled) {
                    contents.push(new vscode.MarkdownString(`**Replicated:** Yes (${symbolResult.replication.condition})`));
                }
                if (symbolResult.category) {
                    contents.push(new vscode.MarkdownString(`**Category:** ${symbolResult.category}`));
                }
                if (symbolResult.className) {
                    contents.push(new vscode.MarkdownString(`**Class:** ${symbolResult.className}`));
                }

                // Try to get default value from CDO
                if (symbolResult.className) {
                    try {
                        const cdoResult = await this.connectionManager.sendRequest('reflection.getCDODefaults', {
                            className: symbolResult.className
                        });
                        if (cdoResult && cdoResult.defaults && cdoResult.defaults[symbolName]) {
                            contents.push(new vscode.MarkdownString(`**Default Value:** \`${cdoResult.defaults[symbolName]}\``));
                        }
                    } catch {
                        // Ignore errors getting CDO defaults
                    }
                }
            }

            // Add metadata summary
            if (symbolResult.metadata) {
                const metadataEntries: string[] = [];
                for (const [key, value] of Object.entries(symbolResult.metadata)) {
                    if (key !== 'Category' && key !== 'ReplicatedUsing') {
                        metadataEntries.push(`${key}: ${value}`);
                    }
                }
                if (metadataEntries.length > 0) {
                    contents.push(new vscode.MarkdownString(`**Metadata:**\n${metadataEntries.join('\n')}`));
                }
            }

            // Add Blueprint exposure status
            if (symbolResult.flags) {
                const flags = symbolResult.flags as string[];
                if (flags.includes('BlueprintCallable') || flags.includes('BlueprintEvent') || 
                    flags.includes('BlueprintReadWrite') || flags.includes('BlueprintReadOnly')) {
                    contents.push(new vscode.MarkdownString('**Blueprint Exposed:** Yes'));
                    
                    // Try to get usage data
                    if (symbolResult.className) {
                        try {
                            const usageResult = await this.connectionManager.sendRequest('reflection.getUsageData', {
                                symbolName: symbolName,
                                className: symbolResult.className
                            });
                            if (usageResult && usageResult.usageCount > 0) {
                                contents.push(new vscode.MarkdownString(`**Used in ${usageResult.usageCount} Blueprint(s)**`));
                                if (usageResult.usedInBlueprints && usageResult.usedInBlueprints.length > 0) {
                                    const blueprintList = usageResult.usedInBlueprints.slice(0, 5).join(', ');
                                    const more = usageResult.usedInBlueprints.length > 5 ? ` (+${usageResult.usedInBlueprints.length - 5} more)` : '';
                                    contents.push(new vscode.MarkdownString(`Used in: ${blueprintList}${more}`));
                                }
                            }
                        } catch {
                            // Ignore errors getting usage data
                        }
                    }
                }
            }

            return new vscode.Hover(contents, wordRange);
        } catch (error) {
            // Silently fail - don't show hover if reflection query fails
            return null;
        }
    }
}

