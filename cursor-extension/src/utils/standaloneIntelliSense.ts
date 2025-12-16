import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import { UnrealPathDetector } from './unrealPathDetector';

const execAsync = promisify(exec);

export interface CompileCommandsResult {
    success: boolean;
    path?: string;
    output: string;
    error?: string;
}

/**
 * Standalone IntelliSense generator that can create compile_commands.json without Unreal Editor
 */
export class StandaloneIntelliSense {
    /**
     * Generate compile_commands.json for a project
     */
    static async generateCompileCommands(
        projectPath: string,
        target: string = 'Editor',
        platform: string = 'Win64',
        configuration: string = 'Development',
        outputChannel?: vscode.OutputChannel
    ): Promise<CompileCommandsResult> {
        const result: CompileCommandsResult = {
            success: false,
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
                outputChannel.appendLine(`[Standalone IntelliSense] Generating compile_commands.json for: ${uprojectFile}`);
            }

            const buildToolDir = path.dirname(paths.buildToolPath);
            const projectDir = path.dirname(uprojectFile);
            const projectName = path.basename(uprojectFile, '.uproject');

            // Use UnrealBuildTool to generate compile database
            // Command: UnrealBuildTool.exe -Mode=GenerateClangDatabase -Project="ProjectPath" -Target="Editor" -Platform="Win64" -Configuration="Development"
            const command = `"${paths.buildToolPath}" -Mode=GenerateClangDatabase -Project="${uprojectFile}" -Target="${target}" -Platform="${platform}" -Configuration="${configuration}"`;

            if (outputChannel) {
                outputChannel.appendLine(`[Standalone IntelliSense] Executing: ${command}`);
            }

            const { stdout, stderr } = await execAsync(command, {
                cwd: projectDir,
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                timeout: 300000 // 5 minute timeout (can take a while)
            });

            const fullOutput = stdout + stderr;
            result.output = fullOutput;

            // Find the generated compile_commands.json
            // It's usually in the project root or .vscode folder
            const possiblePaths = [
                path.join(projectDir, 'compile_commands.json'),
                path.join(projectDir, '.vscode', 'compile_commands.json'),
                path.join(projectDir, 'DerivedDataCache', 'compile_commands.json')
            ];

            for (const possiblePath of possiblePaths) {
                if (fs.existsSync(possiblePath)) {
                    result.path = possiblePath;
                    result.success = true;
                    
                    // Move to .vscode folder if it's not already there
                    const vscodePath = path.join(projectDir, '.vscode', 'compile_commands.json');
                    if (possiblePath !== vscodePath) {
                        // Ensure .vscode directory exists
                        const vscodeDir = path.dirname(vscodePath);
                        if (!fs.existsSync(vscodeDir)) {
                            fs.mkdirSync(vscodeDir, { recursive: true });
                        }
                        
                        // Copy file to .vscode
                        fs.copyFileSync(possiblePath, vscodePath);
                        result.path = vscodePath;
                    }

                    if (outputChannel) {
                        outputChannel.appendLine(`[Standalone IntelliSense] ✓ Generated: ${result.path}`);
                    }
                    break;
                }
            }

            if (!result.success) {
                // Try to find it by searching for "compile_commands.json" in output
                const pathMatch = fullOutput.match(/compile_commands\.json[^\s]*/i);
                if (pathMatch) {
                    const foundPath = pathMatch[0].trim();
                    if (fs.existsSync(foundPath)) {
                        result.path = foundPath;
                        result.success = true;
                    }
                }

                if (!result.success) {
                    result.error = 'compile_commands.json not found after generation. Check output for errors.';
                }
            }

        } catch (error: any) {
            result.error = error.message || 'Unknown error';
            result.output = error.stdout || error.stderr || '';

            if (outputChannel) {
                outputChannel.appendLine(`[Standalone IntelliSense] Error: ${result.error}`);
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
}

