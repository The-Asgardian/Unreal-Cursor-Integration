import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import { UnrealPathDetector } from './unrealPathDetector';

const execAsync = promisify(exec);

export interface UHTResult {
    success: boolean;
    diagnostics: Array<{
        file: string;
        line: number;
        column: number;
        severity: 'error' | 'warning' | 'info';
        message: string;
    }>;
    output: string;
    error?: string;
}

/**
 * Standalone UHT runner that can execute UHT without Unreal Editor
 */
export class StandaloneUHT {
    /**
     * Run UHT check on a project
     */
    static async runCheck(
        projectPath: string,
        outputChannel?: vscode.OutputChannel
    ): Promise<UHTResult> {
        const result: UHTResult = {
            success: false,
            diagnostics: [],
            output: ''
        };

        try {
            // Get Unreal Engine paths
            const paths = await UnrealPathDetector.getPaths(outputChannel);
            
            if (!paths.buildToolPath) {
                result.error = 'UnrealBuildTool not found. Please configure unreal.buildToolPath in settings.';
                return result;
            }

            // Find .uproject file
            const uprojectFile = this.findUProjectFile(projectPath);
            if (!uprojectFile) {
                result.error = 'No .uproject file found in workspace';
                return result;
            }

            if (outputChannel) {
                outputChannel.appendLine(`[Standalone UHT] Running UHT check on: ${uprojectFile}`);
            }

            // Run UnrealBuildTool with -Mode=Validate command
            // This runs UHT validation without a full build
            const buildToolDir = path.dirname(paths.buildToolPath);
            const projectDir = path.dirname(uprojectFile);
            const projectName = path.basename(uprojectFile, '.uproject');

            // Use UnrealBuildTool to run UHT validation
            // Command: UnrealBuildTool.exe -Mode=Validate -Project="ProjectPath" -Target="Editor" -Platform="Win64"
            const command = `"${paths.buildToolPath}" -Mode=Validate -Project="${uprojectFile}" -Target="Editor" -Platform="Win64" -NoEngineChanges -NoHotReloadFromIDE`;

            if (outputChannel) {
                outputChannel.appendLine(`[Standalone UHT] Executing: ${command}`);
            }

            const { stdout, stderr } = await execAsync(command, {
                cwd: projectDir,
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                timeout: 120000 // 2 minute timeout
            });

            const fullOutput = stdout + stderr;
            result.output = fullOutput;

            // Parse UHT diagnostics from output
            result.diagnostics = this.parseUHTOutput(fullOutput);

            // Consider it successful if we got output (even if there are diagnostics)
            result.success = true;

            if (outputChannel) {
                outputChannel.appendLine(`[Standalone UHT] Found ${result.diagnostics.length} diagnostic(s)`);
            }

        } catch (error: any) {
            result.error = error.message || 'Unknown error';
            result.output = error.stdout || error.stderr || '';
            
            // Try to parse diagnostics even from error output
            if (result.output) {
                result.diagnostics = this.parseUHTOutput(result.output);
            }

            if (outputChannel) {
                outputChannel.appendLine(`[Standalone UHT] Error: ${result.error}`);
            }
        }

        return result;
    }

    /**
     * Find .uproject file in workspace
     */
    private static findUProjectFile(workspacePath: string): string | null {
        try {
            const files = fs.readdirSync(workspacePath);
            const uprojectFile = files.find(f => f.endsWith('.uproject'));
            if (uprojectFile) {
                return path.join(workspacePath, uprojectFile);
            }
        } catch {
            // Ignore errors
        }
        return null;
    }

    /**
     * Parse UHT output to extract diagnostics
     */
    private static parseUHTOutput(output: string): UHTResult['diagnostics'] {
        const diagnostics: UHTResult['diagnostics'] = [];
        const lines = output.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Pattern 1: File(Line): Error/Warning: Message
            // Pattern 2: File(Line,Column): Error/Warning: Message
            const pattern1 = /^(.+?)\((\d+)\):\s*(Error|Warning|error|warning):\s*(.+)$/i;
            const pattern2 = /^(.+?)\((\d+),(\d+)\):\s*(Error|Warning|error|warning):\s*(.+)$/i;

            let match = trimmed.match(pattern2);
            if (match) {
                const file = match[1].trim();
                const lineNum = parseInt(match[2], 10);
                const colNum = parseInt(match[3], 10);
                const severity = match[4].toLowerCase() === 'error' ? 'error' : 'warning';
                const message = match[5].trim();

                diagnostics.push({
                    file: this.normalizePath(file),
                    line: lineNum,
                    column: colNum,
                    severity,
                    message
                });
                continue;
            }

            match = trimmed.match(pattern1);
            if (match) {
                const file = match[1].trim();
                const lineNum = parseInt(match[2], 10);
                const severity = match[3].toLowerCase() === 'error' ? 'error' : 'warning';
                const message = match[4].trim();

                diagnostics.push({
                    file: this.normalizePath(file),
                    line: lineNum,
                    column: 0,
                    severity,
                    message
                });
            }
        }

        return diagnostics;
    }

    /**
     * Normalize file path
     */
    private static normalizePath(filePath: string): string {
        // Convert to absolute path if relative
        if (!path.isAbsolute(filePath)) {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const absolutePath = path.join(workspaceFolders[0].uri.fsPath, filePath);
                if (fs.existsSync(absolutePath)) {
                    return absolutePath;
                }
            }
        }
        return filePath.replace(/\\/g, '/');
    }
}

