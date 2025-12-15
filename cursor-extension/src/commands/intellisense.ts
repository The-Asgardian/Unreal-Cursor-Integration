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
}

