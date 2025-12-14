import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.debug.start', async () => {
            if (!connectionState.connected) {
                vscode.window.showErrorMessage('Not connected to Unreal Engine');
                return;
            }

            try {
                // Start PIE for debugging
                await connectionManager.sendRequest('run.playPIE', {});
                vscode.window.showInformationMessage('Debug session started');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to start debugging: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );
}

