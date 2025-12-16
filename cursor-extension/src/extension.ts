import * as vscode from 'vscode';
import { UnrealTreeDataProvider } from './ui/treeView';
import { StatusBarManager } from './ui/statusBar';
import { ConnectionManager } from './ipc/connectionManager';
import { ConnectionState } from './state/connectionState';
import * as buildCommands from './commands/build';
import * as liveCodingCommands from './commands/liveCoding';
import * as runCommands from './commands/run';
import * as logsCommands from './commands/logs';
import * as profilingCommands from './commands/profiling';
import * as assetsCommands from './commands/assets';
import * as intellisenseCommands from './commands/intellisense';
import * as testConnectionCommands from './commands/testConnection';
import * as debugCommands from './commands/debug';
import * as pathsCommands from './commands/paths';
import { BuildViewProvider } from './ui/webviews/buildView';
import { ToolbarViewProvider } from './ui/webviews/toolbarView';
import { detectUnrealProject, hasUnrealProject } from './utils/projectDetector';
import { isUnrealEditorRunning } from './utils/processDetector';
import { UnrealPathDetector } from './utils/unrealPathDetector';
import { UnrealHoverProvider } from './providers/unrealHoverProvider';
import { UnrealDiagnosticsProvider } from './providers/unrealDiagnosticsProvider';
import { UnrealCompletionProvider } from './providers/unrealCompletionProvider';
import { UnrealCodeLensProvider } from './providers/unrealCodeLensProvider';
import { UnrealInlayHintsProvider } from './providers/unrealInlayHintsProvider';

let connectionManager: ConnectionManager | undefined;
let treeDataProvider: UnrealTreeDataProvider | undefined;
let statusBarManager: StatusBarManager | undefined;

export function activate(context: vscode.ExtensionContext) {
    try {
        console.log('Unreal Engine Cursor Integration extension is now active');

        // Initialize state
        const connectionState = new ConnectionState();
        
        // Initialize UI components
        try {
            treeDataProvider = new UnrealTreeDataProvider(connectionState);
            statusBarManager = new StatusBarManager(connectionState);
        } catch (error) {
            console.error('Failed to initialize UI components:', error);
            vscode.window.showErrorMessage(`Failed to initialize UI: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }
        
        // Initialize connection manager
        try {
            connectionManager = new ConnectionManager(connectionState, statusBarManager);
        } catch (error) {
            console.error('Failed to initialize connection manager:', error);
            vscode.window.showErrorMessage(`Failed to initialize connection manager: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }
        
        // Register tree view
        try {
            const treeView = vscode.window.createTreeView('unrealTreeView', {
                treeDataProvider: treeDataProvider,
                showCollapseAll: true
            });
            context.subscriptions.push(treeView);
        } catch (error) {
            console.error('Failed to register tree view:', error);
            vscode.window.showErrorMessage(`Failed to register tree view: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }

        // Register toolbar view
        try {
            const toolbarViewProvider = new ToolbarViewProvider(
                context.extensionUri,
                connectionManager,
                connectionState
            );
            context.subscriptions.push(
                vscode.window.registerWebviewViewProvider(
                    ToolbarViewProvider.viewType,
                    toolbarViewProvider
                )
            );
        } catch (error) {
            console.error('Failed to register toolbar view:', error);
            vscode.window.showErrorMessage(`Failed to register toolbar view: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Register build view
        try {
            const buildViewProvider = new BuildViewProvider(
                context.extensionUri,
                connectionManager,
                connectionState
            );
            context.subscriptions.push(
                vscode.window.registerWebviewViewProvider(
                    BuildViewProvider.viewType,
                    buildViewProvider
                )
            );
        } catch (error) {
            console.error('Failed to register build view:', error);
            vscode.window.showErrorMessage(`Failed to register build view: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Logs are now handled via OutputChannel in commands/logs.ts
        
        // Register commands
        try {
            registerCommands(context, connectionManager, connectionState);
        } catch (error) {
            console.error('Failed to register commands:', error);
            vscode.window.showErrorMessage(`Failed to register commands: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }
        
        // Get output channel for logging
        const outputChannel = connectionManager.outputChannel;
        
        // Initialize path detection and validate required tools (async, non-blocking)
        outputChannel.appendLine('[Extension] Initializing Unreal Engine path detection...');
        (async () => {
            try {
                const paths = await UnrealPathDetector.getPaths(outputChannel);
                
                // Validate paths (warn but don't fail if not found - user might configure later)
                const buildToolValidation = UnrealPathDetector.validatePaths(paths, true, false);
                const editorValidation = UnrealPathDetector.validatePaths(paths, false, true);
                
                if (!buildToolValidation.valid) {
                    outputChannel.appendLine(`[Extension] ⚠ Warning: UnrealBuildTool not found. Missing: ${buildToolValidation.missing.join(', ')}`);
                    outputChannel.appendLine('[Extension] You can configure the path manually using: unreal.paths.configure');
                    
                    // Show notification but don't block activation
                    vscode.window.showWarningMessage(
                        'UnrealBuildTool not found. Some features may not work. Configure path?',
                        'Configure Now',
                        'Later'
                    ).then(choice => {
                        if (choice === 'Configure Now') {
                            vscode.commands.executeCommand('unreal.paths.configure');
                        }
                    });
                }
                
                if (!editorValidation.valid) {
                    outputChannel.appendLine(`[Extension] ⚠ Warning: UnrealEditor not found. Missing: ${editorValidation.missing.join(', ')}`);
                    outputChannel.appendLine('[Extension] You can configure the path manually using: unreal.paths.configure');
                }
                
                if (buildToolValidation.valid && editorValidation.valid) {
                    outputChannel.appendLine('[Extension] ✓ All required Unreal Engine tools detected');
                }
            } catch (error) {
                outputChannel.appendLine(`[Extension] Error during path detection: ${error instanceof Error ? error.message : 'Unknown error'}`);
                // Don't fail activation, just log the error
            }
        })();
        
        // Auto-connect if Unreal project is detected
        outputChannel.appendLine('[Extension] Checking for Unreal Engine project...');
        const hasProject = hasUnrealProject(outputChannel);
        
        if (hasProject) {
            const projectInfo = detectUnrealProject(outputChannel);
            if (projectInfo) {
                outputChannel.appendLine(`[Extension] ✓ Unreal project detected: ${projectInfo.projectName}`);
                outputChannel.appendLine(`[Extension] Checking if Unreal Editor is running...`);
                outputChannel.show(true); // Make sure output channel is visible
                
                // Check if editor is running ONCE - if not, don't retry
                isUnrealEditorRunning(outputChannel).then((isRunning) => {
                    if (!connectionManager) {
                        return;
                    }
                    
                    if (isRunning) {
                        outputChannel.appendLine('[Extension] Editor is running, connecting...');
                        // Connect once - no retry loop
                        connectionManager.connect().catch((error) => {
                            outputChannel.appendLine(`[Extension] Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                            console.error('Connection failed:', error);
                        });
                    } else {
                        outputChannel.appendLine('[Extension] Editor not running. Start the editor to connect.');
                        // Don't start retry loop - user must start editor manually
                    }
                });
            } else {
                outputChannel.appendLine('[Extension] ✗ Project detection returned null');
            }
        } else {
            outputChannel.appendLine('[Extension] No Unreal Engine project detected in workspace');
            // Also check if auto-connect is explicitly enabled in config
            const config = vscode.workspace.getConfiguration('unreal');
            if (config.get<boolean>('autoConnect', false)) {
                outputChannel.appendLine('[Extension] Auto-connect enabled in config, checking for editor...');
                isUnrealEditorRunning(outputChannel).then((isRunning) => {
                    if (!connectionManager) {
                        return;
                    }
                    
                    if (isRunning) {
                        outputChannel.appendLine('[Extension] Editor is running, connecting...');
                        connectionManager.connect().catch((error) => {
                            outputChannel.appendLine(`[Extension] Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                            console.error('Connection failed:', error);
                        });
                    } else {
                        outputChannel.appendLine('[Extension] Editor not running. Start the editor to connect.');
                    }
                });
            }
        }

        // Watch for workspace folder changes to detect new projects
        context.subscriptions.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                if (!connectionManager) {
                    return;
                }
                
                const outputChannel = connectionManager.outputChannel;
                outputChannel.appendLine('[Extension] Workspace folders changed, re-checking for Unreal project...');
                
                if (hasUnrealProject(outputChannel) && !connectionState.connected && !connectionState.connecting) {
                    outputChannel.appendLine('[Extension] Unreal project detected after workspace change, starting auto-connect...');
                    connectionManager.autoConnectWithRetry(false).catch((error) => {
                        outputChannel.appendLine(`[Extension] Auto-connect error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        console.error('Auto-connect failed:', error);
                    });
                }
            })
        );

        // Watch for configuration changes to clear path cache
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('unreal.engineRoot') || 
                    e.affectsConfiguration('unreal.buildToolPath') || 
                    e.affectsConfiguration('unreal.editorPath')) {
                    UnrealPathDetector.clearCache();
                    if (connectionManager) {
                        const outputChannel = connectionManager.outputChannel;
                        outputChannel.appendLine('[Extension] Unreal Engine path configuration changed, cache cleared');
                    }
                }
            })
        );
        
        // Update UI when state changes
        connectionState.onStateChanged(() => {
            treeDataProvider?.refresh();
            statusBarManager?.update();
        });
        
        console.log('Unreal Engine Cursor Integration extension activated successfully');
    } catch (error) {
        console.error('Failed to activate extension:', error);
        vscode.window.showErrorMessage(`Failed to activate Unreal Engine extension: ${error instanceof Error ? error.message : 'Unknown error'}`);
        throw error;
    }
}

function registerCommands(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    try {
        // Connection commands
        context.subscriptions.push(
            vscode.commands.registerCommand('unreal.connect', () => {
                connectionManager.connect();
            })
        );
        
        context.subscriptions.push(
            vscode.commands.registerCommand('unreal.disconnect', () => {
                connectionManager.disconnect();
            })
        );
        
        // Build commands
        try {
            buildCommands.register(context, connectionManager, connectionState);
        } catch (error) {
            console.error('Failed to register build commands:', error);
        }
        
        // Live Coding commands
        try {
            liveCodingCommands.register(context, connectionManager, connectionState);
        } catch (error) {
            console.error('Failed to register live coding commands:', error);
        }
        
        // Run commands
        try {
            runCommands.register(context, connectionManager, connectionState);
        } catch (error) {
            console.error('Failed to register run commands:', error);
        }
        
        // Logs commands
        try {
            logsCommands.register(context, connectionManager, connectionState);
        } catch (error) {
            console.error('Failed to register logs commands:', error);
        }
        
        // Profiling commands
        try {
            profilingCommands.register(context, connectionManager, connectionState);
        } catch (error) {
            console.error('Failed to register profiling commands:', error);
        }
        
        // Assets commands
        try {
            assetsCommands.register(context, connectionManager, connectionState);
        } catch (error) {
            console.error('Failed to register assets commands:', error);
        }
        
        // IntelliSense commands
        try {
            intellisenseCommands.register(context, connectionManager, connectionState);
        } catch (error) {
            console.error('Failed to register intellisense commands:', error);
        }
        
        // Register IntelliSense providers
        try {
            // Hover provider
            const hoverProvider = new UnrealHoverProvider(connectionManager, connectionState);
            context.subscriptions.push(
                vscode.languages.registerHoverProvider('cpp', hoverProvider)
            );
            
            // Diagnostics provider
            const diagnosticsProvider = new UnrealDiagnosticsProvider(connectionManager, connectionState);
            context.subscriptions.push(diagnosticsProvider);
            
            // Watch for document changes to update diagnostics
            context.subscriptions.push(
                vscode.workspace.onDidChangeTextDocument((e) => {
                    diagnosticsProvider.validateDocument(e.document);
                })
            );
            
            // Validate all open documents on activation
            vscode.workspace.textDocuments.forEach((doc) => {
                if (doc.languageId === 'cpp') {
                    diagnosticsProvider.validateDocument(doc);
                }
            });
            
            // Completion provider
            const completionProvider = new UnrealCompletionProvider(connectionManager, connectionState);
            context.subscriptions.push(
                vscode.languages.registerCompletionItemProvider('cpp', completionProvider, '.')
            );
            
            // CodeLens provider
            const codeLensProvider = new UnrealCodeLensProvider(connectionManager, connectionState);
            context.subscriptions.push(
                vscode.languages.registerCodeLensProvider('cpp', codeLensProvider)
            );
            
            // Inlay hints provider
            const inlayHintsProvider = new UnrealInlayHintsProvider(connectionManager, connectionState);
            context.subscriptions.push(
                vscode.languages.registerInlayHintsProvider('cpp', inlayHintsProvider)
            );
        } catch (error) {
            console.error('Failed to register IntelliSense providers:', error);
        }
        
        // Debug commands
        try {
            debugCommands.register(context, connectionManager, connectionState);
        } catch (error) {
            console.error('Failed to register debug commands:', error);
        }
        
        // Test connection command
        try {
            testConnectionCommands.register(context, connectionManager, connectionState);
        } catch (error) {
            console.error('Failed to register test connection command:', error);
        }
        
        // Path configuration commands
        try {
            pathsCommands.register(context, connectionManager, connectionState);
        } catch (error) {
            console.error('Failed to register path configuration commands:', error);
        }
        
        // Settings command
        context.subscriptions.push(
            vscode.commands.registerCommand('unreal.settings.open', () => {
                vscode.commands.executeCommand('workbench.action.openSettings', 'unreal');
            })
        );

        // Build view command
        context.subscriptions.push(
            vscode.commands.registerCommand('unreal.build.openView', () => {
                vscode.commands.executeCommand('unrealBuildView.focus');
            })
        );
    } catch (error) {
        console.error('Error in registerCommands:', error);
        throw error;
    }
}

export function deactivate() {
    connectionManager?.stopAutoConnectRetry();
    connectionManager?.disconnect();
    statusBarManager?.dispose();
}

