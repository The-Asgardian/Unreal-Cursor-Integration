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
        // Only work with C++ files
        const fileName = document.fileName.toLowerCase();
        if (!fileName.endsWith('.cpp') && !fileName.endsWith('.h') && !fileName.endsWith('.hpp') && !fileName.endsWith('.cxx')) {
            return null;
        }

        if (!this.connectionState.connected) {
            // Return null silently - user might not be connected yet
            return null;
        }

        // Get the word at the cursor position
        const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordRange) {
            return null;
        }

        const symbolName = document.getText(wordRange);
        if (!symbolName || symbolName.length < 2) {
            return null; // Skip very short symbols
        }

        // Skip common keywords and types
        const skipSymbols = ['if', 'for', 'while', 'return', 'void', 'int', 'float', 'bool', 'char', 'const', 'static', 'virtual', 'public', 'private', 'protected'];
        if (skipSymbols.includes(symbolName.toLowerCase())) {
            return null;
        }

        try {
            // Check if reflection cache is ready (optional, won't block if not available)
            try {
                const cacheStatus = await this.connectionManager.sendRequest('reflection.cacheStatus', {}, undefined, 2000);
                if (cacheStatus && !cacheStatus.ready) {
                    // Cache not ready yet, but continue anyway (will be slower)
                }
            } catch {
                // Cache status check failed, continue anyway
            }

            // Try to find the symbol in reflection (with longer timeout for first query)
            const symbolResult = await this.connectionManager.sendRequest('reflection.findSymbol', {
                symbolName: symbolName
            }, undefined, 60000); // 60 second timeout for reflection queries

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
            // Check if we should show error notifications
            const config = vscode.workspace.getConfiguration('unreal');
            const showErrors = config.get<boolean>('hover.showErrors', false);

            // Log error for debugging but don't show hover
            // This prevents hover from working if there's a connection issue
            if (error instanceof Error && error.message.includes('NOT_FOUND')) {
                // Symbol not found - this is expected for many symbols, don't log
                return null;
            }

            // For other errors, log and optionally show notification
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.debug(`Hover provider error for symbol '${symbolName}':`, error);
            
            if (showErrors) {
                // Only show notification if user has enabled it
                vscode.window.showWarningMessage(
                    `Hover failed for '${symbolName}': ${errorMessage}`,
                    'Test Hover'
                ).then(choice => {
                    if (choice === 'Test Hover') {
                        vscode.commands.executeCommand('unreal.testHover');
                    }
                });
            }
            
            return null;
        }
    }
}

