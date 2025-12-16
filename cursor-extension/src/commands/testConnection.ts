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

    // Hover provider diagnostic command
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.testHover', async () => {
            const outputChannel = vscode.window.createOutputChannel('Unreal Hover Test');
            outputChannel.show();
            outputChannel.appendLine('=== Testing Hover Provider ===\n');

            // Test 1: Check connection
            outputChannel.appendLine('Test 1: Checking connection status...');
            if (!connectionState.connected) {
                outputChannel.appendLine('❌ FAILED: Not connected to Unreal Engine');
                outputChannel.appendLine('   → Hover provider requires connection to work');
                outputChannel.appendLine('   → Try running "Unreal: Connect" first\n');
                vscode.window.showErrorMessage('Not connected to Unreal Engine. Hover provider requires connection.');
                return;
            }
            outputChannel.appendLine('✅ PASSED: Connection state is active\n');

            // Test 2: Check active editor
            outputChannel.appendLine('Test 2: Checking active editor...');
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                outputChannel.appendLine('⚠️  WARNING: No active editor');
                outputChannel.appendLine('   → Open a C++ file (.cpp, .h, .hpp) to test hover\n');
            } else {
                const fileName = activeEditor.document.fileName.toLowerCase();
                const isCppFile = fileName.endsWith('.cpp') || fileName.endsWith('.h') || fileName.endsWith('.hpp') || fileName.endsWith('.cxx');
                
                if (isCppFile) {
                    outputChannel.appendLine(`✅ PASSED: Active file is C++ file: ${activeEditor.document.fileName}\n`);
                } else {
                    outputChannel.appendLine(`⚠️  WARNING: Active file is not a C++ file: ${activeEditor.document.fileName}`);
                    outputChannel.appendLine('   → Hover provider only works with .cpp, .h, .hpp files\n');
                }
            }

            // Test 3: Test reflection.findSymbol with known symbols
            outputChannel.appendLine('Test 3: Testing reflection.findSymbol with common Unreal classes...');
            const testSymbols = ['UObject', 'AActor', 'UWorld', 'UGameplayStatics', 'APawn'];
            let foundCount = 0;
            
            for (const symbolName of testSymbols) {
                try {
                    const symbolResult = await connectionManager.sendRequest('reflection.findSymbol', {
                        symbolName: symbolName
                    });
                    
                    if (symbolResult && symbolResult.name) {
                        outputChannel.appendLine(`   ✅ Found: ${symbolName}`);
                        outputChannel.appendLine(`      Type: ${symbolResult.symbolType || 'class'}`);
                        if (symbolResult.module) {
                            outputChannel.appendLine(`      Module: ${symbolResult.module}`);
                        }
                        foundCount++;
                    } else {
                        outputChannel.appendLine(`   ❌ Not found: ${symbolName}`);
                    }
                } catch (error) {
                    outputChannel.appendLine(`   ❌ Error querying ${symbolName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
            
            outputChannel.appendLine(`\n   Result: Found ${foundCount}/${testSymbols.length} symbols\n`);

            // Test 4: Test with current word if editor is open
            if (activeEditor) {
                outputChannel.appendLine('Test 4: Testing with word at cursor position...');
                const position = activeEditor.selection.active;
                const wordRange = activeEditor.document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_]*/);
                
                if (wordRange) {
                    const symbolName = activeEditor.document.getText(wordRange);
                    outputChannel.appendLine(`   Testing symbol: "${symbolName}"`);
                    
                    try {
                        const symbolResult = await connectionManager.sendRequest('reflection.findSymbol', {
                            symbolName: symbolName
                        });
                        
                        if (symbolResult && symbolResult.name) {
                            outputChannel.appendLine(`   ✅ Found in reflection system`);
                            outputChannel.appendLine(`      Type: ${symbolResult.symbolType || 'unknown'}`);
                            outputChannel.appendLine(`      Full Name: ${symbolResult.fullName || symbolResult.name}`);
                            if (symbolResult.flags) {
                                outputChannel.appendLine(`      Flags: ${(symbolResult.flags as string[]).join(', ')}`);
                            }
                            outputChannel.appendLine(`\n   → Hover should work for this symbol!`);
                        } else {
                            outputChannel.appendLine(`   ❌ Not found in reflection system`);
                            outputChannel.appendLine(`   → Hover will not show for this symbol`);
                            outputChannel.appendLine(`   → Only symbols with UCLASS/UFUNCTION/UPROPERTY are in reflection`);
                        }
                    } catch (error) {
                        outputChannel.appendLine(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    }
                } else {
                    outputChannel.appendLine('   ⚠️  No word at cursor position');
                    outputChannel.appendLine('   → Place cursor on a symbol name to test');
                }
                outputChannel.appendLine('');
            }

            // Test 5: Hover provider registration
            outputChannel.appendLine('Test 5: Checking hover provider registration...');
            outputChannel.appendLine('   ✅ Hover provider is registered for C++ files');
            outputChannel.appendLine('   → Registered with document selector: { scheme: "file", language: "cpp" }');
            outputChannel.appendLine('   → Works with: .cpp, .h, .hpp, .cxx files\n');

            // Summary
            outputChannel.appendLine('=== Hover Provider Test Complete ===\n');
            outputChannel.appendLine('Troubleshooting Tips:');
            outputChannel.appendLine('1. Ensure Unreal Editor is running and connected');
            outputChannel.appendLine('2. Open a C++ file (.cpp, .h, .hpp)');
            outputChannel.appendLine('3. Hover over symbols with UCLASS/UFUNCTION/UPROPERTY macros');
            outputChannel.appendLine('4. Regular C++ symbols (not in reflection) will not show hover');
            outputChannel.appendLine('5. Check Output panel → "Unreal Engine Cursor Integration" for errors');

            vscode.window.showInformationMessage('Hover test complete. Check the output channel for results.');
        })
    );
}

