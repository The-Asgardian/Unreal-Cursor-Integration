import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

export interface UnrealEnginePaths {
    engineRoot?: string;
    buildToolPath?: string;
    editorPath?: string;
    version?: string;
}

/**
 * Detects Unreal Engine installation paths using multiple strategies
 */
export class UnrealPathDetector {
    private static cachedPaths: UnrealEnginePaths | null = null;

    /**
     * Get cached paths or detect them
     */
    static async getPaths(outputChannel?: vscode.OutputChannel): Promise<UnrealEnginePaths> {
        if (this.cachedPaths) {
            return this.cachedPaths;
        }

        const paths = await this.detectPaths(outputChannel);
        this.cachedPaths = paths;
        return paths;
    }

    /**
     * Clear cached paths (useful when user updates settings)
     */
    static clearCache(): void {
        this.cachedPaths = null;
    }

    /**
     * Detect Unreal Engine paths using multiple strategies
     */
    static async detectPaths(outputChannel?: vscode.OutputChannel): Promise<UnrealEnginePaths> {
        const result: UnrealEnginePaths = {};

        if (outputChannel) {
            outputChannel.appendLine('[Path Detection] Starting Unreal Engine path detection...');
        }

        // Strategy 1: Check manual configuration settings first
        const config = vscode.workspace.getConfiguration('unreal');
        const manualEngineRoot = config.get<string>('engineRoot', '');
        const manualBuildToolPath = config.get<string>('buildToolPath', '');
        const manualEditorPath = config.get<string>('editorPath', '');

        if (manualEngineRoot && fs.existsSync(manualEngineRoot)) {
            result.engineRoot = manualEngineRoot;
            if (outputChannel) {
                outputChannel.appendLine(`[Path Detection] Using manual engine root: ${manualEngineRoot}`);
            }
        }

        if (manualBuildToolPath && fs.existsSync(manualBuildToolPath)) {
            result.buildToolPath = manualBuildToolPath;
            if (outputChannel) {
                outputChannel.appendLine(`[Path Detection] Using manual build tool path: ${manualBuildToolPath}`);
            }
        }

        if (manualEditorPath && fs.existsSync(manualEditorPath)) {
            result.editorPath = manualEditorPath;
            if (outputChannel) {
                outputChannel.appendLine(`[Path Detection] Using manual editor path: ${manualEditorPath}`);
            }
        }

        // Strategy 2: Try to detect from .uproject file
        if (!result.engineRoot || !result.buildToolPath || !result.editorPath) {
            const projectPaths = await this.detectFromProject(outputChannel);
            if (projectPaths.engineRoot && !result.engineRoot) {
                result.engineRoot = projectPaths.engineRoot;
            }
            if (projectPaths.buildToolPath && !result.buildToolPath) {
                result.buildToolPath = projectPaths.buildToolPath;
            }
            if (projectPaths.editorPath && !result.editorPath) {
                result.editorPath = projectPaths.editorPath;
            }
            if (projectPaths.version && !result.version) {
                result.version = projectPaths.version;
            }
        }

        // Strategy 3: Try common installation locations
        if (!result.buildToolPath || !result.editorPath) {
            const commonPaths = await this.detectFromCommonLocations(outputChannel);
            if (commonPaths.engineRoot && !result.engineRoot) {
                result.engineRoot = commonPaths.engineRoot;
            }
            if (commonPaths.buildToolPath && !result.buildToolPath) {
                result.buildToolPath = commonPaths.buildToolPath;
            }
            if (commonPaths.editorPath && !result.editorPath) {
                result.editorPath = commonPaths.editorPath;
            }
            if (commonPaths.version && !result.version) {
                result.version = commonPaths.version;
            }
        }

        // Strategy 4: Try registry/launcher detection (Windows)
        if (process.platform === 'win32' && (!result.buildToolPath || !result.editorPath)) {
            const registryPaths = await this.detectFromRegistry(outputChannel);
            if (registryPaths.engineRoot && !result.engineRoot) {
                result.engineRoot = registryPaths.engineRoot;
            }
            if (registryPaths.buildToolPath && !result.buildToolPath) {
                result.buildToolPath = registryPaths.buildToolPath;
            }
            if (registryPaths.editorPath && !result.editorPath) {
                result.editorPath = registryPaths.editorPath;
            }
            if (registryPaths.version && !result.version) {
                result.version = registryPaths.version;
            }
        }

        // Validate detected paths
        if (result.buildToolPath && !fs.existsSync(result.buildToolPath)) {
            if (outputChannel) {
                outputChannel.appendLine(`[Path Detection] ⚠ Build tool path does not exist: ${result.buildToolPath}`);
            }
            result.buildToolPath = undefined;
        }

        if (result.editorPath && !fs.existsSync(result.editorPath)) {
            if (outputChannel) {
                outputChannel.appendLine(`[Path Detection] ⚠ Editor path does not exist: ${result.editorPath}`);
            }
            result.editorPath = undefined;
        }

        if (outputChannel) {
            if (result.buildToolPath) {
                outputChannel.appendLine(`[Path Detection] ✓ UnrealBuildTool found: ${result.buildToolPath}`);
            } else {
                outputChannel.appendLine(`[Path Detection] ✗ UnrealBuildTool not found`);
            }
            if (result.editorPath) {
                outputChannel.appendLine(`[Path Detection] ✓ UnrealEditor found: ${result.editorPath}`);
            } else {
                outputChannel.appendLine(`[Path Detection] ✗ UnrealEditor not found`);
            }
        }

        return result;
    }

    /**
     * Detect paths from .uproject file
     */
    private static async detectFromProject(outputChannel?: vscode.OutputChannel): Promise<UnrealEnginePaths> {
        const result: UnrealEnginePaths = {};

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return result;
            }

            // Find .uproject file
            const workspacePath = workspaceFolders[0].uri.fsPath;
            const files = fs.readdirSync(workspacePath);
            const uprojectFile = files.find(f => f.endsWith('.uproject'));

            if (!uprojectFile) {
                return result;
            }

            const uprojectPath = path.join(workspacePath, uprojectFile);

            // Read .uproject file to get engine association
            const uprojectContent = fs.readFileSync(uprojectPath, 'utf-8');
            const uprojectJson = JSON.parse(uprojectContent);

            // Check for EngineAssociation (version number or path)
            const engineAssociation = uprojectJson.EngineAssociation;
            if (engineAssociation) {
                if (outputChannel) {
                    outputChannel.appendLine(`[Path Detection] Found EngineAssociation: ${engineAssociation}`);
                }

                // If it's a path, use it directly
                if (fs.existsSync(engineAssociation)) {
                    result.engineRoot = engineAssociation;
                    result.buildToolPath = this.findBuildToolInEngine(engineAssociation);
                    result.editorPath = this.findEditorInEngine(engineAssociation);
                    result.version = this.extractVersionFromPath(engineAssociation);
                } else {
                    // It's a version number, try to find it
                    result.version = engineAssociation;
                    const versionPaths = this.findEngineByVersion(engineAssociation);
                    if (versionPaths.engineRoot) {
                        result.engineRoot = versionPaths.engineRoot;
                        result.buildToolPath = versionPaths.buildToolPath;
                        result.editorPath = versionPaths.editorPath;
                    }
                }
            }
        } catch (error) {
            if (outputChannel) {
                outputChannel.appendLine(`[Path Detection] Error detecting from project: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }

        return result;
    }

    /**
     * Detect paths from common installation locations
     */
    private static async detectFromCommonLocations(outputChannel?: vscode.OutputChannel): Promise<UnrealEnginePaths> {
        const result: UnrealEnginePaths = {};
        const possiblePaths: string[] = [];

        if (process.platform === 'win32') {
            // Check Program Files
            const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
            const epicGamesPath = path.join(programFiles, 'Epic Games');
            
            if (fs.existsSync(epicGamesPath)) {
                const entries = fs.readdirSync(epicGamesPath);
                for (const entry of entries) {
                    if (entry.startsWith('UE_')) {
                        const enginePath = path.join(epicGamesPath, entry, 'Engine');
                        if (fs.existsSync(enginePath)) {
                            possiblePaths.push(enginePath);
                        }
                    }
                }
            }

            // Check Program Files (x86) as well
            const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
            const epicGamesPathX86 = path.join(programFilesX86, 'Epic Games');
            
            if (fs.existsSync(epicGamesPathX86)) {
                const entries = fs.readdirSync(epicGamesPathX86);
                for (const entry of entries) {
                    if (entry.startsWith('UE_')) {
                        const enginePath = path.join(epicGamesPathX86, entry, 'Engine');
                        if (fs.existsSync(enginePath)) {
                            possiblePaths.push(enginePath);
                        }
                    }
                }
            }
        } else if (process.platform === 'darwin') {
            // macOS: Check /Applications/Unreal Engine/
            const applicationsPath = '/Applications/Unreal Engine';
            if (fs.existsSync(applicationsPath)) {
                const entries = fs.readdirSync(applicationsPath);
                for (const entry of entries) {
                    if (entry.startsWith('UE_')) {
                        const enginePath = path.join(applicationsPath, entry, 'Engine');
                        if (fs.existsSync(enginePath)) {
                            possiblePaths.push(enginePath);
                        }
                    }
                }
            }
        } else {
            // Linux: Check common locations
            const homeDir = process.env.HOME || '';
            if (homeDir) {
                const unrealEnginePath = path.join(homeDir, 'UnrealEngine');
                if (fs.existsSync(unrealEnginePath)) {
                    possiblePaths.push(unrealEnginePath);
                }
            }
        }

        // Try paths in reverse order (newer versions first)
        possiblePaths.sort().reverse();

        for (const enginePath of possiblePaths) {
            const buildToolPath = this.findBuildToolInEngine(enginePath);
            const editorPath = this.findEditorInEngine(enginePath);

            if (buildToolPath || editorPath) {
                result.engineRoot = enginePath;
                result.buildToolPath = buildToolPath;
                result.editorPath = editorPath;
                result.version = this.extractVersionFromPath(enginePath);
                
                if (outputChannel) {
                    outputChannel.appendLine(`[Path Detection] Found engine at: ${enginePath}`);
                }
                break;
            }
        }

        return result;
    }

    /**
     * Detect paths from Windows registry (Epic Games Launcher)
     */
    private static async detectFromRegistry(outputChannel?: vscode.OutputChannel): Promise<UnrealEnginePaths> {
        const result: UnrealEnginePaths = {};

        if (process.platform !== 'win32') {
            return result;
        }

        try {
            // Try to read registry using PowerShell
            const psCommand = `Get-ItemProperty -Path "HKCU:\\Software\\Epic Games\\Unreal Engine\\*" -Name "InstalledDirectory" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty InstalledDirectory`;
            const { stdout } = await execAsync(`powershell -Command "${psCommand}"`);
            const paths = stdout.trim().split('\n').filter(p => p.trim());

            for (const enginePath of paths) {
                const trimmedPath = enginePath.trim();
                if (fs.existsSync(trimmedPath)) {
                    const buildToolPath = this.findBuildToolInEngine(trimmedPath);
                    const editorPath = this.findEditorInEngine(trimmedPath);

                    if (buildToolPath || editorPath) {
                        result.engineRoot = trimmedPath;
                        result.buildToolPath = buildToolPath;
                        result.editorPath = editorPath;
                        result.version = this.extractVersionFromPath(trimmedPath);
                        
                        if (outputChannel) {
                            outputChannel.appendLine(`[Path Detection] Found engine in registry: ${trimmedPath}`);
                        }
                        break;
                    }
                }
            }
        } catch (error) {
            // Registry access might fail, that's okay
            if (outputChannel) {
                outputChannel.appendLine(`[Path Detection] Could not read registry (this is normal): ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }

        return result;
    }

    /**
     * Find UnrealBuildTool in engine directory
     */
    private static findBuildToolInEngine(engineRoot: string): string | undefined {
        if (process.platform === 'win32') {
            // Try installed engine path first
            const installedPath = path.join(engineRoot, 'Binaries', 'DotNET', 'UnrealBuildTool', 'UnrealBuildTool.exe');
            if (fs.existsSync(installedPath)) {
                return installedPath;
            }

            // Try source engine path
            const sourcePath = path.join(engineRoot, 'Binaries', 'DotNET', 'UnrealBuildTool.exe');
            if (fs.existsSync(sourcePath)) {
                return sourcePath;
            }
        } else if (process.platform === 'darwin') {
            const ubtPath = path.join(engineRoot, 'Binaries', 'DotNET', 'UnrealBuildTool', 'UnrealBuildTool');
            if (fs.existsSync(ubtPath)) {
                return ubtPath;
            }
        } else {
            const ubtPath = path.join(engineRoot, 'Binaries', 'DotNET', 'UnrealBuildTool', 'UnrealBuildTool');
            if (fs.existsSync(ubtPath)) {
                return ubtPath;
            }
        }

        return undefined;
    }

    /**
     * Find UnrealEditor in engine directory
     */
    private static findEditorInEngine(engineRoot: string): string | undefined {
        if (process.platform === 'win32') {
            const editorPath = path.join(engineRoot, 'Binaries', 'Win64', 'UnrealEditor.exe');
            if (fs.existsSync(editorPath)) {
                return editorPath;
            }
        } else if (process.platform === 'darwin') {
            const editorPath = path.join(engineRoot, 'Binaries', 'Mac', 'UnrealEditor.app', 'Contents', 'MacOS', 'UnrealEditor');
            if (fs.existsSync(editorPath)) {
                return editorPath;
            }
        } else {
            const editorPath = path.join(engineRoot, 'Binaries', 'Linux', 'UnrealEditor');
            if (fs.existsSync(editorPath)) {
                return editorPath;
            }
        }

        return undefined;
    }

    /**
     * Extract version from engine path
     */
    private static extractVersionFromPath(enginePath: string): string | undefined {
        const match = enginePath.match(/UE[_-]?(\d+\.\d+)/i);
        return match ? match[1] : undefined;
    }

    /**
     * Find engine by version number
     */
    private static findEngineByVersion(version: string): UnrealEnginePaths {
        const result: UnrealEnginePaths = {};
        const possiblePaths: string[] = [];

        if (process.platform === 'win32') {
            const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
            const epicGamesPath = path.join(programFiles, 'Epic Games');
            const versionPath = path.join(epicGamesPath, `UE_${version}`, 'Engine');
            if (fs.existsSync(versionPath)) {
                possiblePaths.push(versionPath);
            }

            const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
            const epicGamesPathX86 = path.join(programFilesX86, 'Epic Games');
            const versionPathX86 = path.join(epicGamesPathX86, `UE_${version}`, 'Engine');
            if (fs.existsSync(versionPathX86)) {
                possiblePaths.push(versionPathX86);
            }
        } else if (process.platform === 'darwin') {
            const versionPath = path.join('/Applications/Unreal Engine', `UE_${version}`, 'Engine');
            if (fs.existsSync(versionPath)) {
                possiblePaths.push(versionPath);
            }
        }

        for (const enginePath of possiblePaths) {
            const buildToolPath = this.findBuildToolInEngine(enginePath);
            const editorPath = this.findEditorInEngine(enginePath);

            if (buildToolPath || editorPath) {
                result.engineRoot = enginePath;
                result.buildToolPath = buildToolPath;
                result.editorPath = editorPath;
                result.version = version;
                break;
            }
        }

        return result;
    }

    /**
     * Validate that required paths exist
     */
    static validatePaths(paths: UnrealEnginePaths, requireBuildTool: boolean = false, requireEditor: boolean = false): {
        valid: boolean;
        missing: string[];
    } {
        const missing: string[] = [];

        if (requireBuildTool && (!paths.buildToolPath || !fs.existsSync(paths.buildToolPath))) {
            missing.push('UnrealBuildTool');
        }

        if (requireEditor && (!paths.editorPath || !fs.existsSync(paths.editorPath))) {
            missing.push('UnrealEditor');
        }

        return {
            valid: missing.length === 0,
            missing
        };
    }
}

