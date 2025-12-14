import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.testConnection', async () => {
            const outputChannel = vscode.window.createOutputChannel('Unreal Connection Test');
            outputChannel.show();
            outputChannel.appendLine('=== Testing Connection to Unreal Engine ===\n');

            // Test 1: Check if connected
            outputChannel.appendLine('Test 1: Checking connection status...');
            if (!connectionState.connected) {
                outputChannel.appendLine('❌ FAILED: Not connected to Unreal Engine');
                outputChannel.appendLine('   → Try running "Unreal: Connect" first\n');
                vscode.window.showErrorMessage('Not connected to Unreal Engine. Please connect first.');
                return;
            }
            outputChannel.appendLine('✅ PASSED: Connection state is active\n');

            // Test 2: Ping test
            outputChannel.appendLine('Test 2: Sending ping request...');
            try {
                const pingResult = await connectionManager.sendRequest('ping', {});
                if (pingResult && pingResult.pong === 'pong') {
                    outputChannel.appendLine('✅ PASSED: Ping successful');
                    outputChannel.appendLine(`   Response: ${JSON.stringify(pingResult)}\n`);
                } else {
                    outputChannel.appendLine('❌ FAILED: Unexpected ping response');
                    outputChannel.appendLine(`   Response: ${JSON.stringify(pingResult)}\n`);
                }
            } catch (error) {
                outputChannel.appendLine('❌ FAILED: Ping request failed');
                outputChannel.appendLine(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
            }

            // Test 3: Status check
            outputChannel.appendLine('Test 3: Getting server status...');
            try {
                const statusResult = await connectionManager.sendRequest('status.get', {});
                outputChannel.appendLine('✅ PASSED: Status retrieved');
                outputChannel.appendLine(`   Response: ${JSON.stringify(statusResult, null, 2)}\n`);
            } catch (error) {
                outputChannel.appendLine('❌ FAILED: Status request failed');
                outputChannel.appendLine(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
            }

            // Test 4: Project info
            outputChannel.appendLine('Test 4: Getting project information...');
            try {
                const projectInfo = await connectionManager.sendRequest('project.info', {});
                outputChannel.appendLine('✅ PASSED: Project info retrieved');
                outputChannel.appendLine(`   Project Name: ${projectInfo.projectName || 'N/A'}`);
                outputChannel.appendLine(`   Project Path: ${projectInfo.projectPath || 'N/A'}\n`);
            } catch (error) {
                outputChannel.appendLine('❌ FAILED: Project info request failed');
                outputChannel.appendLine(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
            }

            // Test 5: Connection state info
            outputChannel.appendLine('Test 5: Checking connection state...');
            if (connectionState.projectInfo) {
                outputChannel.appendLine('✅ PASSED: Project info available in connection state');
                outputChannel.appendLine(`   Project: ${connectionState.projectInfo.projectName}`);
                outputChannel.appendLine(`   Engine: ${connectionState.projectInfo.engineVersion}`);
                outputChannel.appendLine(`   Platforms: ${connectionState.projectInfo.supportedPlatforms.join(', ')}`);
                outputChannel.appendLine(`   Capabilities:`);
                outputChannel.appendLine(`     - Live Coding: ${connectionState.projectInfo.capabilities.liveCoding ? 'Yes' : 'No'}`);
                outputChannel.appendLine(`     - Insights: ${connectionState.projectInfo.capabilities.insights ? 'Yes' : 'No'}`);
                outputChannel.appendLine(`     - Asset Editing: ${connectionState.projectInfo.capabilities.assetEditing ? 'Yes' : 'No'}`);
                outputChannel.appendLine(`     - Blueprint Editing: ${connectionState.projectInfo.capabilities.blueprintEditing ? 'Yes' : 'No'}\n`);
            } else {
                outputChannel.appendLine('⚠️  WARNING: Project info not available in connection state');
                outputChannel.appendLine('   This may indicate the handshake did not complete properly\n');
            }

            outputChannel.appendLine('=== Connection Test Complete ===');
            outputChannel.appendLine('\nIf all tests passed, your connection is working correctly!');
            outputChannel.appendLine('You can now use other Unreal Engine commands.');

            vscode.window.showInformationMessage('Connection test complete. Check the output channel for results.');
        })
    );
}

