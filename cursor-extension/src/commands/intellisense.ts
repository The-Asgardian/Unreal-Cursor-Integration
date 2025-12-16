import * as vscode from 'vscode';
import * as path from 'path';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    // Track active generation jobs
    const activeJobs = new Map<string, vscode.Progress<{ message?: string; increment?: number }>>();
    
    // Track which jobs are manual (user-initiated) vs automatic
    const manualJobs = new Set<string>();
    
    // Track pending regeneration to avoid duplicate requests
    let pendingRegeneration: NodeJS.Timeout | null = null;
    let lastRegenerationTime = 0;
    const REGENERATION_DEBOUNCE_MS = 5000; // Wait 5 seconds after last change before regenerating
    const MIN_REGENERATION_INTERVAL_MS = 30000; // Don't regenerate more than once per 30 seconds
    
    // Helper function to check if a file is a C++ source file
    function isCppFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return ext === '.cpp' || ext === '.h' || ext === '.hpp' || ext === '.c' || ext === '.cc';
    }
    
    // Helper function to check if a file is in a Source directory
    function isInSourceDirectory(filePath: string): boolean {
        const normalizedPath = filePath.replace(/\\/g, '/');
        return normalizedPath.includes('/Source/') || normalizedPath.includes('\\Source\\');
    }
    
    // Helper function to automatically trigger Intellisense regeneration
    async function triggerAutoRegeneration(reason: string, silent: boolean = true) {
        if (!connectionState.connected) {
            return;
        }
        
        // Check if generation is already in progress
        try {
            // We can't easily check if generation is in progress from here,
            // but we can check the last regeneration time to avoid spamming
            const now = Date.now();
            if (now - lastRegenerationTime < MIN_REGENERATION_INTERVAL_MS) {
                if (!silent) {
                    connectionManager.outputChannel.appendLine(`[IntelliSense] Skipping auto-regeneration: too soon since last regeneration`);
                }
                return;
            }
            
            if (!silent) {
                connectionManager.outputChannel.appendLine(`[IntelliSense] Auto-regenerating compile_commands.json (${reason})`);
            }
            
            // Use default settings for automatic regeneration
            const result = await connectionManager.sendRequest('intellisense.generateCompileCommands', {
                target: 'Editor',
                platform: 'Win64',
                configuration: 'Development'
            });
            
            if (result.jobId) {
                lastRegenerationTime = Date.now();
                // Mark as automatic (not manual)
                if (!silent) {
                    connectionManager.outputChannel.appendLine(`[IntelliSense] Regeneration started with job ID: ${result.jobId}`);
                }
            }
        } catch (error) {
            // Silently fail for automatic regeneration to avoid spamming errors
            if (!silent) {
                connectionManager.outputChannel.appendLine(`[IntelliSense] Failed to trigger auto-regeneration: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
    }
    
    // Check if auto-regeneration is enabled
    function isAutoRegenerationEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('unreal');
        return config.get<boolean>('intellisense.autoRegenerate', true); // Default to true
    }
    
    // Debounced regeneration function
    function scheduleRegeneration(reason: string) {
        if (!isAutoRegenerationEnabled()) {
            return;
        }
        
        if (pendingRegeneration) {
            clearTimeout(pendingRegeneration);
        }
        
        pendingRegeneration = setTimeout(() => {
            pendingRegeneration = null;
            triggerAutoRegeneration(reason, true);
        }, REGENERATION_DEBOUNCE_MS);
    }

    // Listen for IntelliSense generation events
    connectionManager.onEvent('intellisense.generationStarted', (_event: string, data: { jobId: string; target: string; platform: string; configuration: string }) => {
        vscode.window.showInformationMessage(`IntelliSense generation started (${data.target} ${data.platform} ${data.configuration})`);
    });

    connectionManager.onEvent('intellisense.generationProgress', (_event: string, data: { jobId: string; percent: number; phase?: string }) => {
        const progress = activeJobs.get(data.jobId);
        if (progress) {
            progress.report({
                message: data.phase || `Generating... ${data.percent}%`,
                increment: data.percent
            });
        }
    });

    connectionManager.onEvent('intellisense.generationFinished', (_event: string, data: { jobId: string; success: boolean; path?: string; error?: string }) => {
        activeJobs.delete(data.jobId);
        const isManual = manualJobs.has(data.jobId);
        manualJobs.delete(data.jobId);
        
        if (data.success && data.path) {
            // Only show notification for manual generation, not auto-regeneration
            if (isManual) {
                vscode.window.showInformationMessage(`compile_commands.json generated at: ${data.path}`);
            } else {
                // Silent success for auto-regeneration - just log to output
                connectionManager.outputChannel.appendLine(`[IntelliSense] Auto-regeneration completed successfully`);
            }
            
            // Notify clangd to reload compile_commands.json
            // clangd should automatically detect file changes, but we can also trigger a reload
            try {
                vscode.commands.executeCommand('clangd.restart').catch(() => {
                    // clangd extension might not be installed, ignore
                });
            } catch {
                // Ignore if command doesn't exist
            }
        } else {
            // Show error for both manual and automatic generation
            vscode.window.showErrorMessage(`Failed to generate compile_commands.json: ${data.error || 'Unknown error'}`);
        }
    });

    connectionManager.onEvent('intellisense.generationCancelled', (_event: string, data: { jobId: string }) => {
        activeJobs.delete(data.jobId);
        vscode.window.showInformationMessage('IntelliSense generation cancelled');
    });

    connectionManager.onEvent('intellisense.uhtCheckStarted', (_event: string, data: { jobId: string }) => {
        vscode.window.showInformationMessage('UHT check started');
    });

    connectionManager.onEvent('intellisense.uhtCheckFinished', (_event: string, data: { jobId: string; success: boolean; diagnostics?: Array<{ severity: string; message: string }>; error?: string }) => {
        activeJobs.delete(data.jobId);
        if (data.success) {
            const diagnosticCount = data.diagnostics?.length || 0;
            if (diagnosticCount > 0) {
                vscode.window.showWarningMessage(`UHT check completed with ${diagnosticCount} issue(s)`);
            } else {
                vscode.window.showInformationMessage('UHT check completed with no issues');
            }
        } else {
            vscode.window.showErrorMessage(`UHT check failed: ${data.error || 'Unknown error'}`);
        }
    });

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.intellisense.generateCompileCommands', async () => {
            if (!connectionState.connected) {
                vscode.window.showErrorMessage('Not connected to Unreal Editor');
                return;
            }

            try {
                // Ask for target, platform, and configuration
                const target = await vscode.window.showQuickPick(['Editor', 'Game'], {
                    placeHolder: 'Select build target',
                    title: 'Generate compile_commands.json'
                });
                if (!target) return;

                const platform = await vscode.window.showQuickPick(['Win64', 'Mac', 'Linux'], {
                    placeHolder: 'Select platform',
                    title: 'Generate compile_commands.json'
                });
                if (!platform) return;

                const configuration = await vscode.window.showQuickPick(['Debug', 'DebugGame', 'Development', 'Shipping', 'Test'], {
                    placeHolder: 'Select configuration',
                    title: 'Generate compile_commands.json'
                });
                if (!configuration) return;

                // Start generation
                const result = await connectionManager.sendRequest('intellisense.generateCompileCommands', {
                    target,
                    platform,
                    configuration
                });

                if (result.jobId) {
                    // Mark as manual generation
                    manualJobs.add(result.jobId);
                    
                    // Show progress
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Generating compile_commands.json',
                        cancellable: true
                    }, async (progress, token) => {
                        activeJobs.set(result.jobId, progress);

                        token.onCancellationRequested(() => {
                            connectionManager.sendRequest('intellisense.cancelGeneration', {
                                jobId: result.jobId
                            }).catch(() => {
                                // Ignore errors
                            });
                        });

                        // Wait for completion (events will handle the UI updates)
                        return new Promise<void>((resolve) => {
                            let resolved = false;
                            const finishedHandler = (_event: string, data: { jobId: string }) => {
                                if (!resolved && data.jobId === result.jobId) {
                                    resolved = true;
                                    connectionManager.offEvent('intellisense.generationFinished', finishedHandler);
                                    connectionManager.offEvent('intellisense.generationCancelled', cancelledHandler);
                                    resolve();
                                }
                            };
                            const cancelledHandler = (_event: string, data: { jobId: string }) => {
                                if (!resolved && data.jobId === result.jobId) {
                                    resolved = true;
                                    connectionManager.offEvent('intellisense.generationFinished', finishedHandler);
                                    connectionManager.offEvent('intellisense.generationCancelled', cancelledHandler);
                                    resolve();
                                }
                            };
                            connectionManager.onEvent('intellisense.generationFinished', finishedHandler);
                            connectionManager.onEvent('intellisense.generationCancelled', cancelledHandler);
                        });
                    });
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to start IntelliSense generation: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.intellisense.runUHTCheck', async () => {
            if (!connectionState.connected) {
                vscode.window.showErrorMessage('Not connected to Unreal Editor');
                return;
            }

            try {
                const result = await connectionManager.sendRequest('intellisense.runUHTCheck', {});

                if (result.jobId) {
                    // Show progress
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'Running UHT Check',
                        cancellable: false
                    }, async (progress) => {
                        activeJobs.set(result.jobId, progress);

                        // Wait for completion
                        return new Promise<void>((resolve) => {
                            let resolved = false;
                            const handler = (_event: string, data: { jobId: string }) => {
                                if (!resolved && data.jobId === result.jobId) {
                                    resolved = true;
                                    connectionManager.offEvent('intellisense.uhtCheckFinished', handler);
                                    resolve();
                                }
                            };
                            connectionManager.onEvent('intellisense.uhtCheckFinished', handler);
                        });
                    });
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to start UHT check: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.reflection.exportJson', async () => {
            if (!connectionState.connected) {
                vscode.window.showErrorMessage('Not connected to Unreal Editor');
                return;
            }

            try {
                // Get all classes
                const classesResult = await connectionManager.sendRequest('reflection.listClasses', {});
                const classNames = classesResult.classes || [];

                const classes: any[] = [];
                for (const className of classNames.slice(0, 100)) { // Limit to first 100 for performance
                    try {
                        const classResult = await connectionManager.sendRequest('reflection.getClass', {
                            className: className
                        });
                        if (classResult) {
                            // Get functions and properties
                            const functionsResult = await connectionManager.sendRequest('reflection.getFunctions', {
                                className: className
                            });
                            const propertiesResult = await connectionManager.sendRequest('reflection.getProperties', {
                                className: className
                            });

                            classes.push({
                                ...classResult,
                                functions: functionsResult?.functions || [],
                                properties: propertiesResult?.properties || []
                            });
                        }
                    } catch (error) {
                        // Skip classes that fail to load
                    }
                }

                // Get engine version and project info
                const projectInfo = await connectionManager.sendRequest('project.info', {});

                const exportData = {
                    engineVersion: connectionState.projectInfo?.engineVersion || '',
                    projectName: projectInfo?.projectName || '',
                    projectPath: projectInfo?.projectPath || '',
                    timestamp: new Date().toISOString(),
                    classes: classes
                };

                // Save to file
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file('unreal-reflection-export.json'),
                    filters: {
                        'JSON': ['json']
                    }
                });

                if (uri) {
                    const fs = require('fs');
                    fs.writeFileSync(uri.fsPath, JSON.stringify(exportData, null, 2), 'utf8');
                    vscode.window.showInformationMessage('Reflection data exported successfully');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to export reflection data: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.uht.exportJson', async () => {
            if (!connectionState.connected) {
                vscode.window.showErrorMessage('Not connected to Unreal Editor');
                return;
            }

            try {
                // Get UHT reflection summary
                const summaryResult = await connectionManager.sendRequest('uht.getReflectionSummary', {});
                const modules = summaryResult.modules || [];

                const moduleData: any[] = [];
                for (const moduleName of modules.slice(0, 20)) { // Limit to first 20 modules
                    try {
                        const moduleResult = await connectionManager.sendRequest('uht.runAndCollect', {
                            module: moduleName
                        });
                        if (moduleResult && moduleResult.classes) {
                            moduleData.push({
                                module: moduleName,
                                classes: moduleResult.classes
                            });
                        }
                    } catch (error) {
                        // Skip modules that fail to load
                    }
                }

                // Get engine version and project info
                const projectInfo = await connectionManager.sendRequest('project.info', {});

                const exportData = {
                    engineVersion: connectionState.projectInfo?.engineVersion || '',
                    projectName: projectInfo?.projectName || '',
                    projectPath: projectInfo?.projectPath || '',
                    timestamp: new Date().toISOString(),
                    modules: moduleData
                };

                // Save to file
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file('unreal-uht-export.json'),
                    filters: {
                        'JSON': ['json']
                    }
                });

                if (uri) {
                    const fs = require('fs');
                    fs.writeFileSync(uri.fsPath, JSON.stringify(exportData, null, 2), 'utf8');
                    vscode.window.showInformationMessage('UHT metadata exported successfully');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to export UHT metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.intellisense.exportContext', async () => {
            if (!connectionState.connected) {
                vscode.window.showErrorMessage('Not connected to Unreal Editor');
                return;
            }

            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('No active editor');
                    return;
                }

                const document = editor.document;
                const position = editor.selection.active;
                const fileName = document.fileName;
                const fileContent = document.getText();

                // Extract class name from file (simplified)
                const classMatch = fileContent.match(/class\s+[A-Z_]+_API\s+(\w+)/);
                const className = classMatch ? classMatch[1] : '';

                const context: any = {
                    file: fileName,
                    line: position.line + 1,
                    column: position.character + 1,
                    engineVersion: connectionState.projectInfo?.engineVersion || '',
                    timestamp: new Date().toISOString()
                };

                // Get project info
                const projectInfo = await connectionManager.sendRequest('project.info', {});
                context.projectName = projectInfo?.projectName || '';
                context.projectPath = projectInfo?.projectPath || '';

                // If we found a class, get its reflection data
                if (className) {
                    try {
                        const classResult = await connectionManager.sendRequest('reflection.getClass', {
                            className: className
                        });
                        if (classResult) {
                            context.class = classResult;
                        }
                    } catch (error) {
                        // Ignore errors
                    }
                }

                // Get symbol at cursor position
                const wordRange = document.getWordRangeAtPosition(position);
                if (wordRange) {
                    const symbolName = document.getText(wordRange);
                    try {
                        const symbolResult = await connectionManager.sendRequest('reflection.findSymbol', {
                            symbolName: symbolName
                        });
                        if (symbolResult) {
                            context.symbol = symbolResult;
                        }
                    } catch (error) {
                        // Ignore errors
                    }
                }

                // Copy to clipboard
                const jsonStr = JSON.stringify(context, null, 2);
                await vscode.env.clipboard.writeText(jsonStr);
                vscode.window.showInformationMessage('IntelliSense context copied to clipboard');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to export context: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        })
    );
    
    // Watch for file creation events to trigger Intellisense regeneration
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{cpp,h,hpp,c,cc}');
    
    fileWatcher.onDidCreate(async (uri) => {
        if (!connectionState.connected) {
            return;
        }
        
        const filePath = uri.fsPath;
        if (isCppFile(filePath) && isInSourceDirectory(filePath)) {
            connectionManager.outputChannel.appendLine(`[IntelliSense] New C++ file detected: ${path.basename(filePath)}`);
            scheduleRegeneration(`new file: ${path.basename(filePath)}`);
        }
    });
    
    context.subscriptions.push(fileWatcher);
    
    // Watch for document saves to trigger Intellisense regeneration
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (!connectionState.connected) {
                return;
            }
            
            const filePath = document.uri.fsPath;
            if (isCppFile(filePath) && isInSourceDirectory(filePath)) {
                // Only regenerate if the file has meaningful changes (not just whitespace)
                // We'll regenerate on save, but debounced
                scheduleRegeneration(`file saved: ${path.basename(filePath)}`);
            }
        })
    );
    
    // Watch for workspace file changes (handles files created outside VS Code)
    const workspaceFileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{cpp,h,hpp,c,cc}');
    
    workspaceFileWatcher.onDidChange(async (uri) => {
        if (!connectionState.connected) {
            return;
        }
        
        const filePath = uri.fsPath;
        if (isCppFile(filePath) && isInSourceDirectory(filePath)) {
            // File was modified externally - schedule regeneration
            scheduleRegeneration(`file changed: ${path.basename(filePath)}`);
        }
    });
    
    context.subscriptions.push(workspaceFileWatcher);
    
    // Clean up pending regeneration on deactivation
    context.subscriptions.push({
        dispose: () => {
            if (pendingRegeneration) {
                clearTimeout(pendingRegeneration);
                pendingRegeneration = null;
            }
        }
    });
}

