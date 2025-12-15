import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    // Set up run event handlers
    const setupEventHandlers = () => {
        if (connectionManager.isConnected) {
            connectionManager.onEvent('run.pieStatus', (_event: string, data: { running: boolean }) => {
                connectionState.pieRunning = data.running;
            });
            
            connectionManager.onEvent('run.gameStarted', () => {
                // Game started event
            });
            
            connectionManager.onEvent('run.gameStopped', () => {
                connectionState.pieRunning = false;
                connectionState.piePaused = false;
            });
            
            connectionManager.onEvent('run.piePaused', (_event: string, data: { paused: boolean }) => {
                connectionState.piePaused = data.paused;
            });
        }
    };

    // Set up handlers when connected
    if (connectionState.connected) {
        setupEventHandlers();
    } else {
        const disposable = connectionState.onStateChanged(() => {
            if (connectionState.connected) {
                setupEventHandlers();
                disposable.dispose();
            }
        });
        context.subscriptions.push(disposable);
    }

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.run.playPIE', async () => {
            try {
                await connectionManager.sendRequest('run.playPIE', {});
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
    
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.run.dedicatedServer', async () => {
            try {
                await connectionManager.sendRequest('run.dedicatedServer', {});
                vscode.window.showInformationMessage('Dedicated server started');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to start dedicated server: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.run.pausePIE', async () => {
            try {
                const isPaused = connectionState.piePaused;
                await connectionManager.sendRequest('run.pausePIE', { pause: !isPaused });
                connectionState.piePaused = !isPaused;
                vscode.window.showInformationMessage(isPaused ? 'Play In Editor resumed' : 'Play In Editor paused');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to ${connectionState.piePaused ? 'resume' : 'pause'} PIE: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );
}

