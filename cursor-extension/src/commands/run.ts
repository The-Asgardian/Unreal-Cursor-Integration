import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.run.playPIE', async () => {
            try {
                await connectionManager.sendRequest('run.playPIE', {});
                connectionState.pieRunning = true;
                vscode.window.showInformationMessage('Play In Editor started');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to start PIE: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.run.stopPIE', async () => {
            try {
                await connectionManager.sendRequest('run.stopPIE', {});
                connectionState.pieRunning = false;
                vscode.window.showInformationMessage('Play In Editor stopped');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to stop PIE: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.run.standalone', async () => {
            try {
                await connectionManager.sendRequest('run.standalone', {});
                vscode.window.showInformationMessage('Standalone game started');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to start standalone: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );
}

