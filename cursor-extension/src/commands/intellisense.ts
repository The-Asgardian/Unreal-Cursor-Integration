import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.intellisense.generateCompileCommands', async () => {
            try {
                const result = await connectionManager.sendRequest('intellisense.generateCompileCommands', {});
                vscode.window.showInformationMessage(`compile_commands.json generated at: ${result.path}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to generate compile_commands.json: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );
}

