import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    // Set up live coding event handlers
    const client = (connectionManager as any).client;
    if (client) {
        client.onEvent('livecoding.statusChanged', (_event: string, data: { enabled: boolean; compiling: boolean }) => {
            connectionState.liveCodingEnabled = data.enabled;
            connectionState.liveCodingCompiling = data.compiling;
        });
        
        client.onEvent('livecoding.outputLine', (_event: string, data: { line: string }) => {
            const outputChannel = vscode.window.createOutputChannel('Unreal Live Coding');
            outputChannel.appendLine(data.line);
        });
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.liveCoding.compile', async () => {
            if (!connectionState.capabilities?.liveCoding) {
                vscode.window.showWarningMessage('Live Coding is not supported in this Unreal Engine version');
                return;
            }

            try {
                await connectionManager.sendRequest('livecoding.compile', {});
                vscode.window.showInformationMessage('Live Coding compile started');
            } catch (error) {
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

