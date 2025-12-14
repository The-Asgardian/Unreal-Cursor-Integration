import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface UnrealProjectInfo {
    uprojectPath: string;
    projectName: string;
    projectDir: string;
}

/**
 * Detects if the current workspace contains an Unreal Engine project
 */
export function detectUnrealProject(outputChannel?: vscode.OutputChannel): UnrealProjectInfo | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (outputChannel) {
        outputChannel.appendLine('[Project Detection] Checking workspace folders...');
    }
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
        if (outputChannel) {
            outputChannel.appendLine('[Project Detection] No workspace folders found');
        }
        return null;
    }

    if (outputChannel) {
        outputChannel.appendLine(`[Project Detection] Found ${workspaceFolders.length} workspace folder(s)`);
    }

    // Check each workspace folder
    for (const folder of workspaceFolders) {
        const folderPath = folder.uri.fsPath;
        
        if (outputChannel) {
            outputChannel.appendLine(`[Project Detection] Checking folder: ${folderPath}`);
        }
        
        // Look for .uproject files in the root
        try {
            const files = fs.readdirSync(folderPath);
            
            if (outputChannel) {
                outputChannel.appendLine(`[Project Detection] Found ${files.length} files in folder`);
            }
            
            const uprojectFile = files.find(f => f.endsWith('.uproject'));
            
            if (uprojectFile) {
                const uprojectPath = path.join(folderPath, uprojectFile);
                const projectName = path.basename(uprojectFile, '.uproject');
                
                // Normalize path separators for consistent logging
                const normalizedPath = uprojectPath.replace(/\\/g, '/');
                
                if (outputChannel) {
                    outputChannel.appendLine(`[Project Detection] ✓ Found .uproject file: ${uprojectFile}`);
                    outputChannel.appendLine(`[Project Detection]   Project Name: ${projectName}`);
                    outputChannel.appendLine(`[Project Detection]   Project Path: ${normalizedPath}`);
                }
                
                return {
                    uprojectPath,
                    projectName,
                    projectDir: folderPath
                };
            } else {
                if (outputChannel) {
                    outputChannel.appendLine(`[Project Detection] No .uproject file found in ${folderPath}`);
                    // List files for debugging
                    const uprojectFiles = files.filter(f => f.includes('uproject'));
                    if (uprojectFiles.length > 0) {
                        outputChannel.appendLine(`[Project Detection]   Found files containing 'uproject': ${uprojectFiles.join(', ')}`);
                    }
                }
            }
        } catch (error) {
            if (outputChannel) {
                outputChannel.appendLine(`[Project Detection] Error reading directory ${folderPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            continue;
        }
    }

    if (outputChannel) {
        outputChannel.appendLine('[Project Detection] ✗ No Unreal Engine project detected');
    }

    return null;
}

/**
 * Checks if an Unreal Engine project is detected in the workspace
 */
export function hasUnrealProject(outputChannel?: vscode.OutputChannel): boolean {
    return detectUnrealProject(outputChannel) !== null;
}

