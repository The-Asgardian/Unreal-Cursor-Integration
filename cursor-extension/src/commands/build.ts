import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';
import { BuildStartRequest } from '../ipc/protocol';
import { BuildDiagnosticsManager, BuildDiagnostic } from '../diagnostics/buildDiagnostics';

let buildDiagnosticsManager: BuildDiagnosticsManager | undefined;
let buildOutputChannel: vscode.OutputChannel | undefined;

/**
 * Get or create the build output channel (shared for all logs)
 */
export function getBuildOutputChannel(): vscode.OutputChannel {
    if (!buildOutputChannel) {
        buildOutputChannel = vscode.window.createOutputChannel('Unreal Build');
    }
    return buildOutputChannel;
}

export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    // Initialize diagnostics manager
    buildDiagnosticsManager = new BuildDiagnosticsManager();
    context.subscriptions.push(buildDiagnosticsManager);
    
    // Initialize build output channel (shared for all logs)
    buildOutputChannel = getBuildOutputChannel();
    context.subscriptions.push(buildOutputChannel);
    
    // Set up build event handlers
    // Register handlers that will be called when events arrive
    const setupEventHandlers = () => {
        if (connectionManager.isConnected) {
            connectionManager.onEvent('build.started', (_event: string, data: { buildId: string; target: string }) => {
                connectionState.buildInProgress = true;
                connectionState.currentBuildId = data.buildId;
                
                // Log build start to output channel
                buildOutputChannel = getBuildOutputChannel();
                buildOutputChannel.appendLine(`=== Build Started: ${data.target} ===`);
                buildOutputChannel.show(true);
            });
            
            connectionManager.onEvent('build.progress', (_event: string, data: { buildId: string; percent: number; phase?: string }) => {
                // Log progress to output channel
                if (buildOutputChannel && data.phase) {
                    buildOutputChannel.appendLine(`[${data.percent}%] ${data.phase}`);
                }
            });
            
            connectionManager.onEvent('build.outputLine', (_event: string, data: { buildId: string; line: string; category: string }) => {
                buildOutputChannel = getBuildOutputChannel();
                // Log all build output lines
                buildOutputChannel.appendLine(data.line);
                // Show the output channel so user can see build progress
                buildOutputChannel.show(true);
            });
            
            connectionManager.onEvent('build.diagnostic', (_event: string, data: BuildDiagnostic) => {
                if (buildDiagnosticsManager) {
                    buildDiagnosticsManager.addDiagnostic(data);
                }
            });
            
            connectionManager.onEvent('build.finished', (_event: string, data: { buildId: string; success: boolean; duration?: number; error?: string }) => {
                connectionState.buildInProgress = false;
                connectionState.currentBuildId = undefined;
                
                if (buildDiagnosticsManager && data.buildId) {
                    // Keep diagnostics for failed builds, clear on success
                    if (data.success) {
                        buildDiagnosticsManager.clearBuildDiagnostics(data.buildId);
                    }
                }
                
                // Log build completion to output channel
                if (buildOutputChannel) {
                    if (data.success) {
                        buildOutputChannel.appendLine(`=== Build Completed Successfully${data.duration ? ` (${data.duration.toFixed(1)}s)` : ''} ===`);
                    } else {
                        buildOutputChannel.appendLine(`=== Build Failed${data.error ? `: ${data.error}` : ''} ===`);
                    }
                    buildOutputChannel.show(true);
                }
                
                if (data.success) {
                    vscode.window.showInformationMessage(`Build completed successfully${data.duration ? ` (${data.duration.toFixed(1)}s)` : ''}`);
                } else {
                    vscode.window.showErrorMessage(`Build failed${data.error ? `: ${data.error}` : ''}`);
                }
            });
            
            connectionManager.onEvent('build.cancelled', (_event: string, data: { buildId: string }) => {
                connectionState.buildInProgress = false;
                connectionState.currentBuildId = undefined;
                
                if (buildDiagnosticsManager && data.buildId) {
                    buildDiagnosticsManager.clearBuildDiagnostics(data.buildId);
                }
                
                // Log cancellation to output channel
                if (buildOutputChannel) {
                    buildOutputChannel.appendLine('=== Build Cancelled ===');
                    buildOutputChannel.show(true);
                }
                
                vscode.window.showInformationMessage('Build cancelled');
            });
        }
    };
    
    // Set up handlers when connection is established
    if (connectionState.connected) {
        setupEventHandlers();
    } else {
        // Wait for connection
        const disposable = connectionState.onStateChanged(() => {
            if (connectionState.connected) {
                setupEventHandlers();
                disposable.dispose();
            }
        });
        context.subscriptions.push(disposable);
    }

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
        vscode.commands.registerCommand('unreal.build.cancel', async () => {
            if (connectionState.currentBuildId) {
                try {
                    await connectionManager.sendRequest('build.cancel', { buildId: connectionState.currentBuildId });
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to cancel build: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            } else {
                vscode.window.showWarningMessage('No build in progress');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.build.rebuild', async () => {
            // Clean first, then build
            await executeBuild(connectionManager, connectionState, 'Editor', 'Development', ['-clean']);
            // Wait a bit then start build
            setTimeout(async () => {
                await executeBuild(connectionManager, connectionState, 'Editor', 'Development');
            }, 1000);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.build.listTargets', async () => {
            try {
                const result = await connectionManager.sendRequest('build.listTargets', {});
                const message = `Targets: ${result.targets?.join(', ') || 'N/A'}\nConfigs: ${result.configurations?.join(', ') || 'N/A'}\nPlatforms: ${result.platforms?.join(', ') || 'N/A'}`;
                vscode.window.showInformationMessage(message);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to list targets: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
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
    
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.editor.launch', async () => {
            try {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    vscode.window.showErrorMessage('No workspace folder open');
                    return;
                }
                
                // Find .uproject file
                const workspacePath = workspaceFolders[0].uri.fsPath;
                const fs = require('fs');
                const path = require('path');
                
                const files = fs.readdirSync(workspacePath);
                const uprojectFile = files.find((f: string) => f.endsWith('.uproject'));
                
                if (!uprojectFile) {
                    vscode.window.showErrorMessage('No .uproject file found in workspace');
                    return;
                }
                
                const uprojectPath = path.join(workspacePath, uprojectFile);
                const projectName = path.basename(uprojectPath, '.uproject');
                
                // Show build output channel
                buildOutputChannel = getBuildOutputChannel();
                buildOutputChannel.clear();
                buildOutputChannel.appendLine('=== Building Unreal Editor ===');
                buildOutputChannel.show(true);
                
                // Build Editor first (like Rider does)
                vscode.window.showInformationMessage('Building Unreal Editor...');
                
                // If connected, use IPC build. Otherwise, build locally
                // For project builds, the target is ProjectNameEditor, not just Editor
                if (connectionState.connected) {
                    try {
                        await executeBuild(connectionManager, connectionState, `${projectName}Editor`, 'Development');
                        
                        // Wait for build to complete
                        const buildCheckInterval = setInterval(() => {
                            if (!connectionState.buildInProgress) {
                                clearInterval(buildCheckInterval);
                                
                                // Launch editor after build completes
                                launchEditorAfterBuild(uprojectPath, connectionManager, connectionState);
                            }
                        }, 1000);
                        
                        // Timeout after 5 minutes
                        setTimeout(() => {
                            clearInterval(buildCheckInterval);
                        }, 300000);
                        
                    } catch (error) {
                        vscode.window.showErrorMessage(`Build failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    }
                } else {
                    // Build locally using UBT directly
                    await buildEditorLocally(uprojectPath, buildOutputChannel);
                    
                    // Launch editor after build
                    launchEditorAfterBuild(uprojectPath, connectionManager, connectionState);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to launch editor: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );
}

/**
 * Resolves a target name to the project-specific target if needed.
 * For 'Editor' target, returns 'ProjectNameEditor' based on the .uproject file in workspace.
 */
function resolveTarget(target: string): string {
    // If target is 'Editor', resolve to project-specific Editor target
    if (target === 'Editor') {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const fs = require('fs');
            const path = require('path');
            const workspacePath = workspaceFolders[0].uri.fsPath;
            
            try {
                const files = fs.readdirSync(workspacePath);
                const uprojectFile = files.find((f: string) => f.endsWith('.uproject'));
                if (uprojectFile) {
                    const projectName = path.basename(uprojectFile, '.uproject');
                    return `${projectName}Editor`;
                }
            } catch (error) {
                // If we can't find the project, fall back to 'Editor'
            }
        }
    }
    return target;
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
        // Resolve 'Editor' to project-specific Editor target
        const resolvedTarget = resolveTarget(target);
        
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const projectPath = workspaceFolders?.[0]?.uri.fsPath || '';

        const request: BuildStartRequest = {
            target: resolvedTarget,
            configuration,
            platform: process.platform === 'win32' ? 'Win64' : process.platform === 'darwin' ? 'Mac' : 'Linux',
            projectPath,
            extraArgs
        };

        const result = await connectionManager.sendRequest('build.start', request);
        vscode.window.showInformationMessage(`Build started: ${resolvedTarget} ${configuration}`);
    } catch (error) {
        connectionState.buildInProgress = false;
        vscode.window.showErrorMessage(`Build failed to start: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

async function buildEditorLocally(
    uprojectPath: string,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    return new Promise((resolve, reject) => {
        const fs = require('fs');
        const path = require('path');
        const { spawn } = require('child_process');
        
        // Find UBT
        let ubtPath = '';
        const projectDir = path.dirname(uprojectPath);
        
        // Try to find engine from .uproject file or common locations
        if (process.platform === 'win32') {
            const possiblePaths = [
                'C:\\Program Files\\Epic Games\\UE_5.6\\Engine\\Binaries\\DotNET\\UnrealBuildTool\\UnrealBuildTool.exe',
                'C:\\Program Files\\Epic Games\\UE_5.5\\Engine\\Binaries\\DotNET\\UnrealBuildTool\\UnrealBuildTool.exe',
                'C:\\Program Files\\Epic Games\\UE_5.4\\Engine\\Binaries\\DotNET\\UnrealBuildTool\\UnrealBuildTool.exe',
            ];
            
            ubtPath = possiblePaths.find((p: string) => fs.existsSync(p)) || '';
        }
        
        if (!ubtPath) {
            reject(new Error('UnrealBuildTool not found. Please build from Unreal Editor.'));
            return;
        }
        
        // Build command: ProjectNameEditor Win64 Development -project="path"
        // For project builds, the target is ProjectNameEditor, not just Editor
        const projectName = path.basename(uprojectPath, '.uproject');
        const buildArgs = [
            `${projectName}Editor`,  // Project-specific Editor target
            'Win64',
            'Development',
            `-project=${uprojectPath}`  // No quotes needed when shell: false
        ];
        
        outputChannel.appendLine(`Running: ${ubtPath} ${buildArgs.join(' ')}`);
        
        // Use shell: false to properly handle paths with spaces
        // When shell: true is used, Windows cmd.exe doesn't properly quote paths with spaces
        const buildProcess = spawn(ubtPath, buildArgs, {
            cwd: projectDir,
            shell: false
        });
        
        buildProcess.stdout.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    outputChannel.appendLine(line.trim());
                }
            }
        });
        
        buildProcess.stderr.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    outputChannel.appendLine(line.trim());
                }
            }
        });
        
        buildProcess.on('close', (code: number) => {
            if (code === 0) {
                outputChannel.appendLine('=== Build Completed Successfully ===');
                resolve();
            } else {
                outputChannel.appendLine(`=== Build Failed (exit code: ${code}) ===`);
                reject(new Error(`Build failed with exit code ${code}`));
            }
        });
        
        buildProcess.on('error', (error: Error) => {
            outputChannel.appendLine(`Build error: ${error.message}`);
            reject(error);
        });
    });
}

async function launchEditorAfterBuild(
    uprojectPath: string,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    const fs = require('fs');
    const { spawn } = require('child_process');
    
    let editorPath: string;
    
    if (process.platform === 'win32') {
        // Try to find UnrealEditor.exe
        const possiblePaths = [
            'C:\\Program Files\\Epic Games\\UE_5.6\\Engine\\Binaries\\Win64\\UnrealEditor.exe',
            'C:\\Program Files\\Epic Games\\UE_5.5\\Engine\\Binaries\\Win64\\UnrealEditor.exe',
            'C:\\Program Files\\Epic Games\\UE_5.4\\Engine\\Binaries\\Win64\\UnrealEditor.exe',
        ];
        
        editorPath = possiblePaths.find((p: string) => fs.existsSync(p)) || '';
        
        if (!editorPath) {
            const choice = await vscode.window.showInputBox({
                prompt: 'Enter path to UnrealEditor.exe',
                placeHolder: 'C:\\Program Files\\Epic Games\\UE_5.6\\Engine\\Binaries\\Win64\\UnrealEditor.exe'
            });
            
            if (choice) {
                editorPath = choice;
            } else {
                return;
            }
        }
    } else if (process.platform === 'darwin') {
        editorPath = '/Applications/Unreal Engine/UE_5.6/UnrealEditor.app/Contents/MacOS/UnrealEditor';
    } else {
        editorPath = '';
    }
    
    if (!editorPath || !fs.existsSync(editorPath)) {
        vscode.window.showErrorMessage(`Unreal Editor not found. Please specify the path to UnrealEditor.`);
        return;
    }
    
    // Launch editor
    if (buildOutputChannel) {
        buildOutputChannel.appendLine('=== Launching Unreal Editor ===');
    }
    spawn(editorPath, [uprojectPath], { detached: true, stdio: 'ignore' });
    vscode.window.showInformationMessage('Launching Unreal Editor...');
    
    // Auto-connect after editor starts (wait for process, then connect)
    const { waitForUnrealEditor } = require('../utils/processDetector');
    const outputChannel = connectionManager.outputChannel;
    
    outputChannel.appendLine('[Editor Launch] Waiting for Unreal Editor to start...');
    const editorStarted = await waitForUnrealEditor(30000, 1000, outputChannel); // 30 seconds max
    
    if (editorStarted) {
        outputChannel.appendLine('[Editor Launch] Editor started, connecting...');
        // Connect once - no retry loop
        connectionManager.connect().catch((error) => {
            outputChannel.appendLine(`[Editor Launch] Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        });
    } else {
        outputChannel.appendLine('[Editor Launch] Editor start timeout. You can connect manually.');
    }
}

