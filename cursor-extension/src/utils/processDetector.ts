import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Detects if Unreal Editor process is running
 */
export async function isUnrealEditorRunning(outputChannel?: vscode.OutputChannel): Promise<boolean> {
    try {
        if (process.platform === 'win32') {
            // Windows: Use tasklist to check for UnrealEditor.exe
            const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq UnrealEditor.exe" /FO CSV /NH');
            const isRunning = stdout.trim().toLowerCase().includes('unrealeditor.exe');
            
            if (outputChannel) {
                outputChannel.appendLine(`[Process Detection] UnrealEditor.exe ${isRunning ? 'is running' : 'not found'}`);
            }
            
            return isRunning;
        } else if (process.platform === 'darwin') {
            // macOS: Use pgrep to check for UnrealEditor
            try {
                await execAsync('pgrep -f "UnrealEditor"');
                if (outputChannel) {
                    outputChannel.appendLine('[Process Detection] UnrealEditor is running');
                }
                return true;
            } catch {
                if (outputChannel) {
                    outputChannel.appendLine('[Process Detection] UnrealEditor not found');
                }
                return false;
            }
        } else {
            // Linux: Use pgrep
            try {
                await execAsync('pgrep -f "UnrealEditor"');
                if (outputChannel) {
                    outputChannel.appendLine('[Process Detection] UnrealEditor is running');
                }
                return true;
            } catch {
                if (outputChannel) {
                    outputChannel.appendLine('[Process Detection] UnrealEditor not found');
                }
                return false;
            }
        }
    } catch (error) {
        if (outputChannel) {
            outputChannel.appendLine(`[Process Detection] Error checking process: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        return false;
    }
}

/**
 * Watches for Unreal Editor process to start
 * Returns a promise that resolves when the process is detected
 */
export async function waitForUnrealEditor(
    maxWaitTime: number = 30000, // 30 seconds
    checkInterval: number = 1000, // 1 second
    outputChannel?: vscode.OutputChannel
): Promise<boolean> {
    const startTime = Date.now();
    
    if (outputChannel) {
        outputChannel.appendLine(`[Process Detection] Waiting for Unreal Editor to start (max ${maxWaitTime}ms)...`);
    }
    
    while (Date.now() - startTime < maxWaitTime) {
        if (await isUnrealEditorRunning(outputChannel)) {
            if (outputChannel) {
                outputChannel.appendLine('[Process Detection] ✓ Unreal Editor detected');
            }
            return true;
        }
        
        await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
    
    if (outputChannel) {
        outputChannel.appendLine('[Process Detection] ✗ Timeout waiting for Unreal Editor');
    }
    
    return false;
}

