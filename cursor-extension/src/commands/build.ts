import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';
import { BuildStartRequest } from '../ipc/protocol';

export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.build.editor', async () => {
            await executeBuild(connectionManager, connectionState, 'Editor', 'Development');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.build.game', async () => {
            await executeBuild(connectionManager, connectionState, 'Game', 'Development');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.build.clean', async () => {
            await executeBuild(connectionManager, connectionState, 'Editor', 'Development', ['-clean']);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.project.generateFiles', async () => {
            try {
                await connectionManager.sendRequest('project.generateFiles', {});
                vscode.window.showInformationMessage('Project files generated successfully');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to generate project files: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );
}

async function executeBuild(
    connectionManager: ConnectionManager,
    connectionState: ConnectionState,
    target: string,
    configuration: string,
    extraArgs?: string[]
) {
    if (connectionState.buildInProgress) {
        vscode.window.showWarningMessage('Build already in progress');
        return;
    }

    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const projectPath = workspaceFolders?.[0]?.uri.fsPath || '';

        const request: BuildStartRequest = {
            target,
            configuration,
            platform: process.platform === 'win32' ? 'Win64' : process.platform === 'darwin' ? 'Mac' : 'Linux',
            projectPath,
            extraArgs
        };

        connectionState.buildInProgress = true;
        await connectionManager.sendRequest('build.start', request);
        vscode.window.showInformationMessage(`Build started: ${target} ${configuration}`);
    } catch (error) {
        connectionState.buildInProgress = false;
        vscode.window.showErrorMessage(`Build failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

