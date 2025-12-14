import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.logs.open', async () => {
            // TODO: Implement logs webview in Phase 4
            vscode.window.showInformationMessage('Logs view will be available in Phase 4');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.logs.clear', async () => {
            try {
                await connectionManager.sendRequest('logs.clear', {});
                vscode.window.showInformationMessage('Logs cleared');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to clear logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
                try {
                    await connectionManager.sendRequest('logs.setFilter', { filter });
                    vscode.window.showInformationMessage(`Log filter set: ${filter}`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to set log filter: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.logs.exportJson', async () => {
            try {
                const result = await connectionManager.sendRequest('logs.export', {
                    filters: {},
                    timeRange: {}
                });
                
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file('unreal-logs.json'),
                    filters: {
                        'JSON': ['json']
                    }
                });

                if (uri) {
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(result, null, 2)));
                    vscode.window.showInformationMessage('Logs exported successfully');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to export logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );
}

