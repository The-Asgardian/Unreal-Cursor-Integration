import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';
import { BuildStartRequest } from '../ipc/protocol';
import { BuildDiagnosticsManager, BuildDiagnostic } from '../diagnostics/buildDiagnostics';
import { UnrealPathDetector } from '../utils/unrealPathDetector';

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
        vscode.commands.registerCommand('unreal.project.refresh', async () => {
            try {
                // Refresh solution - regenerate project files and refresh IntelliSense
                await connectionManager.sendRequest('project.generateFiles', {});
                // Optionally trigger IntelliSense refresh
                try {
                    await Promise.resolve(vscode.commands.executeCommand('unreal.intellisense.generateCompileCommands'));
                } catch {
                    // Ignore if IntelliSense command fails
                }
                vscode.window.showInformationMessage('Solution refreshed');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to refresh solution: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    return new Promise(async (resolve, reject) => {
        const fs = require('fs');
        const path = require('path');
        const { spawn } = require('child_process');
        
        // Find UBT using path detector
        outputChannel.appendLine('[Build] Detecting UnrealBuildTool...');
        const paths = await UnrealPathDetector.getPaths(outputChannel);
        
        if (!paths.buildToolPath) {
            const validation = UnrealPathDetector.validatePaths(paths, true, false);
            if (!validation.valid) {
                outputChannel.appendLine(`[Build] ✗ UnrealBuildTool not found. Missing: ${validation.missing.join(', ')}`);
                outputChannel.appendLine('[Build] Please configure the path manually using: unreal.paths.configure');
                
                const configureChoice = await vscode.window.showErrorMessage(
                    'UnrealBuildTool not found. Would you like to configure the path manually?',
                    'Configure Path',
                    'Cancel'
                );
                
                if (configureChoice === 'Configure Path') {
                    await vscode.commands.executeCommand('unreal.paths.configure');
                    // Retry detection after configuration
                    UnrealPathDetector.clearCache();
                    const newPaths = await UnrealPathDetector.getPaths(outputChannel);
                    if (!newPaths.buildToolPath) {
                        reject(new Error('UnrealBuildTool not found. Please configure the path in settings.'));
                        return;
                    }
                    paths.buildToolPath = newPaths.buildToolPath;
                } else {
                    reject(new Error('UnrealBuildTool not found. Please configure the path in settings (unreal.buildToolPath).'));
                    return;
                }
            }
        }
        
        const ubtPath = paths.buildToolPath!;
        const projectDir = path.dirname(uprojectPath);
        
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
    
    // Detect editor path using path detector
    const outputChannel = connectionManager.outputChannel;
    outputChannel.appendLine('[Editor Launch] Detecting UnrealEditor...');
    const paths = await UnrealPathDetector.getPaths(outputChannel);
    
    let editorPath = paths.editorPath;
    
    if (!editorPath) {
        const validation = UnrealPathDetector.validatePaths(paths, false, true);
        if (!validation.valid) {
            outputChannel.appendLine(`[Editor Launch] ✗ UnrealEditor not found. Missing: ${validation.missing.join(', ')}`);
            outputChannel.appendLine('[Editor Launch] Please configure the path manually using: unreal.paths.configure');
            
            const configureChoice = await vscode.window.showErrorMessage(
                'UnrealEditor not found. Would you like to configure the path manually?',
                'Configure Path',
                'Cancel'
            );
            
            if (configureChoice === 'Configure Path') {
                await vscode.commands.executeCommand('unreal.paths.configure');
                // Retry detection after configuration
                UnrealPathDetector.clearCache();
                const newPaths = await UnrealPathDetector.getPaths(outputChannel);
                if (!newPaths.editorPath) {
                    // Fallback to manual input
                    const choice = await vscode.window.showInputBox({
                        prompt: 'Enter path to UnrealEditor executable',
                        placeHolder: process.platform === 'win32' 
                            ? 'C:\\Program Files\\Epic Games\\UE_5.6\\Engine\\Binaries\\Win64\\UnrealEditor.exe'
                            : process.platform === 'darwin'
                            ? '/Applications/Unreal Engine/UE_5.6/UnrealEditor.app/Contents/MacOS/UnrealEditor'
                            : '~/UnrealEngine/Engine/Binaries/Linux/UnrealEditor'
                    });
                    
                    if (choice && fs.existsSync(choice)) {
                        editorPath = choice;
                    } else {
                        vscode.window.showErrorMessage('Unreal Editor not found. Please configure the path in settings (unreal.editorPath).');
                        return;
                    }
                } else {
                    editorPath = newPaths.editorPath;
                }
            } else {
                vscode.window.showErrorMessage('Unreal Editor not found. Please configure the path in settings (unreal.editorPath).');
                return;
            }
        }
    }
    
    if (!editorPath || !fs.existsSync(editorPath)) {
        vscode.window.showErrorMessage(`Unreal Editor not found at: ${editorPath || 'unknown'}. Please configure the path in settings (unreal.editorPath).`);
        return;
    }
    
    // Launch editor with output capture
    if (buildOutputChannel) {
        buildOutputChannel.appendLine('=== Launching Unreal Editor ===');
        buildOutputChannel.appendLine(`Editor Path: ${editorPath}`);
        buildOutputChannel.appendLine(`Project: ${uprojectPath}`);
    }
    
    // Capture process output (stdout and stderr) to stream to build output channel
    // Use 'pipe' instead of 'ignore' to capture output
    const editorProcess = spawn(editorPath, [uprojectPath], { 
        detached: false,  // Keep attached to capture output
        stdio: ['ignore', 'pipe', 'pipe']  // stdin: ignore, stdout: pipe, stderr: pipe
    });
    
    // Stream stdout to build output channel
    editorProcess.stdout.on('data', (data: Buffer) => {
        if (buildOutputChannel) {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    buildOutputChannel.appendLine(`[Editor] ${line.trim()}`);
                }
            }
        }
    });
    
    // Stream stderr to build output channel
    editorProcess.stderr.on('data', (data: Buffer) => {
        if (buildOutputChannel) {
            const lines = data.toString().split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    buildOutputChannel.appendLine(`[Editor Error] ${line.trim()}`);
                }
            }
        }
    });
    
    // Handle process exit
    editorProcess.on('exit', (code: number | null, signal: string | null) => {
        if (buildOutputChannel) {
            if (code === 0) {
                buildOutputChannel.appendLine('=== Unreal Editor Process Exited Successfully ===');
            } else {
                buildOutputChannel.appendLine(`=== Unreal Editor Process Exited (code: ${code}, signal: ${signal}) ===`);
            }
        }
    });
    
    // Handle process errors
    editorProcess.on('error', (error: Error) => {
        if (buildOutputChannel) {
            buildOutputChannel.appendLine(`[Editor Launch Error] ${error.message}`);
        }
        vscode.window.showErrorMessage(`Failed to launch editor: ${error.message}`);
    });
    
    // Keep process attached - don't use unref() so we stay attached for the lifetime of the process
    // This allows us to continue capturing output and monitor the process
    
    vscode.window.showInformationMessage('Launching Unreal Editor...');
    
    if (buildOutputChannel) {
        buildOutputChannel.appendLine('=== Waiting for Unreal Editor to initialize ===');
        buildOutputChannel.appendLine('Monitoring process output and waiting for plugin to be ready...');
    }
    
    // Auto-connect when editor is initialized
    // We'll continuously try to connect until successful or process exits
    // (outputChannel already declared above)
    outputChannel.appendLine('[Editor Launch] Waiting for Unreal Editor to initialize...');
    
    // Track if process has exited
    let processExited = false;
    
    // Monitor process exit
    editorProcess.on('exit', (code: number | null, signal: string | null) => {
        processExited = true;
        if (buildOutputChannel) {
            if (code === 0) {
                buildOutputChannel.appendLine('=== Unreal Editor Process Exited Successfully ===');
            } else {
                buildOutputChannel.appendLine(`=== Unreal Editor Process Exited (code: ${code}, signal: ${signal}) ===`);
            }
        }
        
        // Disconnect if connected
        if (connectionState.connected) {
            connectionManager.disconnect();
        }
    });
    
    // Function to attempt connection with retry
    const attemptConnection = async (maxAttempts: number = 60, intervalMs: number = 2000): Promise<void> => {
        let attempts = 0;
        
        while (attempts < maxAttempts && !processExited && !editorProcess.killed) {
            attempts++;
            
            // Check if already connected
            if (connectionState.connected) {
                if (buildOutputChannel) {
                    buildOutputChannel.appendLine('=== Already connected to Unreal Editor ===');
                }
                return;
            }
            
            // Try to connect
            try {
                if (buildOutputChannel && attempts === 1) {
                    buildOutputChannel.appendLine('=== Attempting to connect to Unreal Editor plugin... ===');
                }
                
                await connectionManager.connect();
                
                // Connection successful
                if (buildOutputChannel) {
                    buildOutputChannel.appendLine('=== ✓ Connected to Unreal Editor - Logs will now stream via IPC ===');
                }
                outputChannel.appendLine('[Editor Launch] ✓ Successfully connected to Unreal Editor');
                
                // Auto-subscribe to logs once connected
                try {
                    await Promise.resolve(vscode.commands.executeCommand('unreal.logs.subscribe'));
                } catch {
                    // Ignore if subscription fails
                }
                
                return;
            } catch (error) {
                // Connection failed, will retry
                if (attempts % 5 === 0) { // Log every 5th attempt to reduce spam
                    if (buildOutputChannel) {
                        buildOutputChannel.appendLine(`[Connection Attempt ${attempts}] Waiting for plugin to be ready...`);
                    }
                }
                
                // Wait before next attempt (but check if process exited during wait)
                await new Promise(resolve => setTimeout(resolve, intervalMs));
                
                // Check again if process exited during wait
                if (processExited || editorProcess.killed) {
                    break;
                }
            }
        }
        
        // If we get here, either max attempts reached or process exited
        if (!processExited && !editorProcess.killed) {
            if (buildOutputChannel) {
                buildOutputChannel.appendLine(`=== Connection timeout after ${maxAttempts} attempts ===`);
                buildOutputChannel.appendLine('=== You can connect manually using the Connect button ===');
            }
            outputChannel.appendLine('[Editor Launch] Connection timeout. Editor may still be initializing. You can connect manually.');
        } else if (processExited || editorProcess.killed) {
            if (buildOutputChannel) {
                buildOutputChannel.appendLine('=== Editor process exited before connection could be established ===');
            }
        }
    };
    
    // Start connection attempts in background
    attemptConnection().catch((error) => {
        if (buildOutputChannel) {
            buildOutputChannel.appendLine(`[Connection Error] ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        outputChannel.appendLine(`[Editor Launch] Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    });
    
    // Note: Process exit handler is defined above in attemptConnection scope
    // The process will stay attached and we'll continue capturing output until it exits
}

