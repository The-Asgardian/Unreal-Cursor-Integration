import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';
import { getBuildOutputChannel } from './build';

let isSubscribed: boolean = false;
let logEntries: any[] = [];
let currentFilters: {
    categories: string[];
    verbosity: string;
    search: string;
} = {
    categories: [],
    verbosity: 'All',
    search: ''
};

export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    // Use the shared build output channel for all logs (build, editor, game)
    // No separate logs channel - everything goes to "Unreal Build"

    // Set up log event handlers
    const setupEventHandlers = () => {
        if (connectionManager.isConnected) {
            connectionManager.onEvent('logs.line', (_event: string, data: any) => {
                if (isSubscribed) {
                    // Format log entry
                    const timestamp = data.timestamp || new Date().toLocaleTimeString();
                    const category = data.category || 'LogTemp';
                    const verbosity = data.verbosity || 'Log';
                    const message = data.message || '';
                    
                    // Apply filters
                    if (shouldShowLog(data)) {
                        // Get the shared build output channel
                        const buildOutputChannel = getBuildOutputChannel();
                        
                        // Color code by verbosity
                        let prefix = `[${timestamp}] [${category}] [${verbosity}]`;
                        buildOutputChannel.appendLine(`${prefix} ${message}`);
                        
                        // Store for export
                        logEntries.push(data);
                        if (logEntries.length > 10000) {
                            logEntries = logEntries.slice(-10000);
                        }
                    }
                }
            });
        }
    };

    // Set up handlers when connected
    if (connectionState.connected) {
        setupEventHandlers();
        // Auto-subscribe to all logs
        autoSubscribe(connectionManager);
    } else {
        const disposable = connectionState.onStateChanged(() => {
            if (connectionState.connected) {
                setupEventHandlers();
                // Auto-subscribe to all logs
                autoSubscribe(connectionManager);
                disposable.dispose();
            }
        });
        context.subscriptions.push(disposable);
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.logs.open', async () => {
            const buildOutputChannel = getBuildOutputChannel();
            buildOutputChannel.show(true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.logs.clear', async () => {
            const buildOutputChannel = getBuildOutputChannel();
            buildOutputChannel.clear();
            logEntries = [];
            try {
                await connectionManager.sendRequest('logs.clear', {});
            } catch (error) {
                // Ignore errors
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.logs.setFilter', async () => {
            const filter = await vscode.window.showInputBox({
                prompt: 'Enter log filter (category, verbosity, or search term)',
                placeHolder: 'e.g., LogTemp, Warning, or search term'
            });

            if (filter !== undefined) {
                currentFilters.search = filter;
                try {
                    await connectionManager.sendRequest('logs.setFilter', { filter });
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to set log filter: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.logs.exportJson', async () => {
            try {
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file('unreal-logs.json'),
                    filters: {
                        'JSON': ['json']
                    }
                });

                if (uri) {
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(logEntries, null, 2)));
                    vscode.window.showInformationMessage('Logs exported successfully');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to export logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.logs.subscribe', async () => {
            await autoSubscribe(connectionManager);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.logs.unsubscribe', async () => {
            try {
                await connectionManager.sendRequest('logs.unsubscribe', {});
                isSubscribed = false;
                vscode.window.showInformationMessage('Unsubscribed from logs');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to unsubscribe: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );
}

async function autoSubscribe(connectionManager: ConnectionManager): Promise<void> {
    try {
        await connectionManager.sendRequest('logs.subscribe', {
            categories: [],
            verbosity: '',
            search: ''
        });
        isSubscribed = true;
        const buildOutputChannel = getBuildOutputChannel();
        buildOutputChannel.appendLine('=== Subscribed to Unreal Editor logs via IPC ===');
        buildOutputChannel.show(true);
    } catch (error) {
        // Ignore errors
        const buildOutputChannel = getBuildOutputChannel();
        buildOutputChannel.appendLine(`[Warning] Failed to subscribe to logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

function shouldShowLog(log: any): boolean {
    // Category filter
    if (currentFilters.categories.length > 0) {
        const category = (log.category || '').toLowerCase();
        const matches = currentFilters.categories.some(cat => 
            category.includes(cat.toLowerCase())
        );
        if (!matches) {
            return false;
        }
    }
    
    // Verbosity filter
    if (currentFilters.verbosity !== 'All') {
        if (log.verbosity !== currentFilters.verbosity) {
            return false;
        }
    }
    
    // Search filter
    if (currentFilters.search) {
        const searchLower = currentFilters.search.toLowerCase();
        const message = (log.message || '').toLowerCase();
        const category = (log.category || '').toLowerCase();
        if (!message.includes(searchLower) && !category.includes(searchLower)) {
            return false;
        }
    }
    
    return true;
}
