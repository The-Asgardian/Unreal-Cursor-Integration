import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';
import { ProfilingStartRequest } from '../ipc/protocol';

export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.profiling.start', async () => {
            if (connectionState.profilingActive) {
                vscode.window.showWarningMessage('Profiling already active');
                return;
            }

            try {
                const request: ProfilingStartRequest = {
                    mode: 'stats',
                    intervalMs: 1000
                };
                await connectionManager.sendRequest('profiling.start', request);
                connectionState.profilingActive = true;
                vscode.window.showInformationMessage('Profiling started');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to start profiling: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.profiling.stop', async () => {
            try {
                await connectionManager.sendRequest('profiling.stop', {});
                connectionState.profilingActive = false;
                vscode.window.showInformationMessage('Profiling stopped');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to stop profiling: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.profiling.openDashboard', async () => {
            // TODO: Implement profiling dashboard webview in Phase 7
            vscode.window.showInformationMessage('Profiling dashboard will be available in Phase 7');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.profiling.exportSession', async () => {
            try {
                const sessionId = await vscode.window.showInputBox({
                    prompt: 'Enter session ID (leave empty for current session)',
                    placeHolder: 'Session ID'
                });

                const result = await connectionManager.sendRequest('profiling.exportSession', {
                    sessionId: sessionId || undefined
                });

                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file('unreal-profiling-session.json'),
                    filters: {
                        'JSON': ['json']
                    }
                });

                if (uri) {
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(result, null, 2)));
                    vscode.window.showInformationMessage('Profiling session exported successfully');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to export profiling session: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );
}

