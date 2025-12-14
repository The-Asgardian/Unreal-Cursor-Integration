import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.liveCoding.compile', async () => {
            if (!connectionState.capabilities?.liveCoding) {
                vscode.window.showWarningMessage('Live Coding is not supported in this Unreal Engine version');
                return;
            }

            try {
                connectionState.liveCodingCompiling = true;
                await connectionManager.sendRequest('livecoding.compile', {});
                vscode.window.showInformationMessage('Live Coding compile started');
            } catch (error) {
                connectionState.liveCodingCompiling = false;
                vscode.window.showErrorMessage(`Live Coding compile failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.liveCoding.toggle', async () => {
            if (!connectionState.capabilities?.liveCoding) {
                vscode.window.showWarningMessage('Live Coding is not supported in this Unreal Engine version');
                return;
            }

            try {
                const enabled = !connectionState.liveCodingEnabled;
                await connectionManager.sendRequest('livecoding.enable', { enabled });
                connectionState.liveCodingEnabled = enabled;
                vscode.window.showInformationMessage(`Live Coding ${enabled ? 'enabled' : 'disabled'}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to toggle Live Coding: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.liveCoding.restart', async () => {
            if (!connectionState.capabilities?.liveCoding) {
                vscode.window.showWarningMessage('Live Coding is not supported in this Unreal Engine version');
                return;
            }

            try {
                await connectionManager.sendRequest('livecoding.restart', {});
                vscode.window.showInformationMessage('Live Coding restarted');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to restart Live Coding: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );
}

