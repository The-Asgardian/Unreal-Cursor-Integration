import * as vscode from 'vscode';
import { UnrealPathDetector } from '../utils/unrealPathDetector';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';
import * as fs from 'fs';
import * as path from 'path';

export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    // Command to configure paths manually
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.paths.configure', async () => {
            const outputChannel = connectionManager.outputChannel;
            outputChannel.appendLine('[Path Configuration] Opening path configuration...');
            
            // First, try to detect paths automatically
            outputChannel.appendLine('[Path Configuration] Attempting automatic detection...');
            UnrealPathDetector.clearCache();
            const detectedPaths = await UnrealPathDetector.getPaths(outputChannel);
            
            const config = vscode.workspace.getConfiguration('unreal');
            
            // Show quick pick to select what to configure
            const configureChoice = await vscode.window.showQuickPick([
                {
                    label: '$(tools) Configure UnrealBuildTool Path',
                    description: detectedPaths.buildToolPath || 'Not detected',
                    detail: 'Path to UnrealBuildTool executable',
                    value: 'buildTool'
                },
                {
                    label: '$(rocket) Configure UnrealEditor Path',
                    description: detectedPaths.editorPath || 'Not detected',
                    detail: 'Path to UnrealEditor executable',
                    value: 'editor'
                },
                {
                    label: '$(folder) Configure Engine Root',
                    description: detectedPaths.engineRoot || 'Not detected',
                    detail: 'Path to Unreal Engine root directory',
                    value: 'engineRoot'
                },
                {
                    label: '$(sync) Re-detect All Paths',
                    description: 'Clear cache and re-detect automatically',
                    detail: 'Forces automatic detection to run again',
                    value: 'redetect'
                },
                {
                    label: '$(check) Validate Current Paths',
                    description: 'Check if configured paths are valid',
                    detail: 'Verifies that all paths exist and are correct',
                    value: 'validate'
                }
            ], {
                placeHolder: 'Select what to configure'
            });
            
            if (!configureChoice) {
                return;
            }
            
            if (configureChoice.value === 'redetect') {
                UnrealPathDetector.clearCache();
                const newPaths = await UnrealPathDetector.getPaths(outputChannel);
                
                if (newPaths.buildToolPath) {
                    await config.update('buildToolPath', newPaths.buildToolPath, vscode.ConfigurationTarget.Workspace);
                    outputChannel.appendLine(`[Path Configuration] ✓ Updated buildToolPath: ${newPaths.buildToolPath}`);
                }
                if (newPaths.editorPath) {
                    await config.update('editorPath', newPaths.editorPath, vscode.ConfigurationTarget.Workspace);
                    outputChannel.appendLine(`[Path Configuration] ✓ Updated editorPath: ${newPaths.editorPath}`);
                }
                if (newPaths.engineRoot) {
                    await config.update('engineRoot', newPaths.engineRoot, vscode.ConfigurationTarget.Workspace);
                    outputChannel.appendLine(`[Path Configuration] ✓ Updated engineRoot: ${newPaths.engineRoot}`);
                }
                
                vscode.window.showInformationMessage('Paths re-detected and updated');
                return;
            }
            
            if (configureChoice.value === 'validate') {
                const currentPaths = await UnrealPathDetector.getPaths(outputChannel);
                const buildToolValid = currentPaths.buildToolPath && fs.existsSync(currentPaths.buildToolPath);
                const editorValid = currentPaths.editorPath && fs.existsSync(currentPaths.editorPath);
                const engineRootValid = currentPaths.engineRoot && fs.existsSync(currentPaths.engineRoot);
                
                const messages: string[] = [];
                if (buildToolValid) {
                    messages.push(`✓ UnrealBuildTool: ${currentPaths.buildToolPath}`);
                } else {
                    messages.push(`✗ UnrealBuildTool: ${currentPaths.buildToolPath || 'Not found'}`);
                }
                if (editorValid) {
                    messages.push(`✓ UnrealEditor: ${currentPaths.editorPath}`);
                } else {
                    messages.push(`✗ UnrealEditor: ${currentPaths.editorPath || 'Not found'}`);
                }
                if (engineRootValid) {
                    messages.push(`✓ Engine Root: ${currentPaths.engineRoot}`);
                } else {
                    messages.push(`✗ Engine Root: ${currentPaths.engineRoot || 'Not found'}`);
                }
                
                vscode.window.showInformationMessage(messages.join('\n'));
                outputChannel.appendLine('[Path Configuration] Validation results:');
                messages.forEach(msg => outputChannel.appendLine(`  ${msg}`));
                return;
            }
            
            // Configure specific path
            let currentValue = '';
            let prompt = '';
            let placeHolder = '';
            
            if (configureChoice.value === 'buildTool') {
                currentValue = config.get<string>('buildToolPath', '') || detectedPaths.buildToolPath || '';
                prompt = 'Enter path to UnrealBuildTool executable';
                placeHolder = process.platform === 'win32'
                    ? 'C:\\Program Files\\Epic Games\\UE_5.6\\Engine\\Binaries\\DotNET\\UnrealBuildTool\\UnrealBuildTool.exe'
                    : process.platform === 'darwin'
                    ? '/Applications/Unreal Engine/UE_5.6/Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool'
                    : '~/UnrealEngine/Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool';
            } else if (configureChoice.value === 'editor') {
                currentValue = config.get<string>('editorPath', '') || detectedPaths.editorPath || '';
                prompt = 'Enter path to UnrealEditor executable';
                placeHolder = process.platform === 'win32'
                    ? 'C:\\Program Files\\Epic Games\\UE_5.6\\Engine\\Binaries\\Win64\\UnrealEditor.exe'
                    : process.platform === 'darwin'
                    ? '/Applications/Unreal Engine/UE_5.6/UnrealEditor.app/Contents/MacOS/UnrealEditor'
                    : '~/UnrealEngine/Engine/Binaries/Linux/UnrealEditor';
            } else if (configureChoice.value === 'engineRoot') {
                currentValue = config.get<string>('engineRoot', '') || detectedPaths.engineRoot || '';
                prompt = 'Enter path to Unreal Engine root directory';
                placeHolder = process.platform === 'win32'
                    ? 'C:\\Program Files\\Epic Games\\UE_5.6\\Engine'
                    : process.platform === 'darwin'
                    ? '/Applications/Unreal Engine/UE_5.6/Engine'
                    : '~/UnrealEngine/Engine';
            }
            
            const input = await vscode.window.showInputBox({
                prompt,
                placeHolder,
                value: currentValue,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Path cannot be empty. Leave empty to use auto-detection.';
                    }
                    
                    const trimmedValue = value.trim();
                    
                    if (configureChoice.value === 'engineRoot') {
                        // For engine root, check if it's a directory
                        if (!fs.existsSync(trimmedValue)) {
                            return 'Path does not exist';
                        }
                        if (!fs.statSync(trimmedValue).isDirectory()) {
                            return 'Path is not a directory';
                        }
                    } else {
                        // For executables, check if file exists
                        if (!fs.existsSync(trimmedValue)) {
                            return 'File does not exist';
                        }
                        if (!fs.statSync(trimmedValue).isFile()) {
                            return 'Path is not a file';
                        }
                    }
                    
                    return null;
                }
            });
            
            if (input === undefined) {
                return; // User cancelled
            }
            
            if (input.trim().length === 0) {
                // Clear the setting to use auto-detection
                if (configureChoice.value === 'buildTool') {
                    await config.update('buildToolPath', '', vscode.ConfigurationTarget.Workspace);
                    outputChannel.appendLine('[Path Configuration] Cleared buildToolPath (will use auto-detection)');
                } else if (configureChoice.value === 'editor') {
                    await config.update('editorPath', '', vscode.ConfigurationTarget.Workspace);
                    outputChannel.appendLine('[Path Configuration] Cleared editorPath (will use auto-detection)');
                } else if (configureChoice.value === 'engineRoot') {
                    await config.update('engineRoot', '', vscode.ConfigurationTarget.Workspace);
                    outputChannel.appendLine('[Path Configuration] Cleared engineRoot (will use auto-detection)');
                }
                
                UnrealPathDetector.clearCache();
                vscode.window.showInformationMessage('Path cleared. Auto-detection will be used.');
                return;
            }
            
            const trimmedInput = path.normalize(input.trim());
            
            // Update the configuration
            if (configureChoice.value === 'buildTool') {
                await config.update('buildToolPath', trimmedInput, vscode.ConfigurationTarget.Workspace);
                outputChannel.appendLine(`[Path Configuration] ✓ Updated buildToolPath: ${trimmedInput}`);
            } else if (configureChoice.value === 'editor') {
                await config.update('editorPath', trimmedInput, vscode.ConfigurationTarget.Workspace);
                outputChannel.appendLine(`[Path Configuration] ✓ Updated editorPath: ${trimmedInput}`);
            } else if (configureChoice.value === 'engineRoot') {
                await config.update('engineRoot', trimmedInput, vscode.ConfigurationTarget.Workspace);
                outputChannel.appendLine(`[Path Configuration] ✓ Updated engineRoot: ${trimmedInput}`);
            }
            
            // Clear cache so new paths are used
            UnrealPathDetector.clearCache();
            
            vscode.window.showInformationMessage(`Path configured successfully`);
        })
    );
}

