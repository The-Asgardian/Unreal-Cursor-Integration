import * as vscode from 'vscode';
import { hasUnrealProject } from '../utils/projectDetector';

/**
 * Workspace guard that ensures planning validation only runs in appropriate contexts
 */
export class PlanningWorkspaceGuard {
    /**
     * Checks if planning validation can be performed in the current workspace
     */
    static async canValidate(): Promise<{ allowed: boolean; reason?: string; canEnable?: boolean }> {
        // Check 1: Unreal project detection
        const hasProject = hasUnrealProject();
        if (!hasProject) {
            return {
                allowed: false,
                reason: "Not an Unreal Engine project. Unreal Planning Validator only works with Unreal projects.",
                canEnable: false
            };
        }

        // Check 2: Opt-in setting
        const config = vscode.workspace.getConfiguration('unreal');
        const planningEnabled = config.get<boolean>('planning.enabled', false);
        if (!planningEnabled) {
            return {
                allowed: false,
                reason: "Unreal Planning Validator is not enabled for this workspace. Enable it in settings: unreal.planning.enabled",
                canEnable: true
            };
        }

        return { allowed: true };
    }

    /**
     * Enables planning validation for the current workspace
     */
    static async enable(): Promise<void> {
        const config = vscode.workspace.getConfiguration('unreal');
        await config.update('planning.enabled', true, vscode.ConfigurationTarget.Workspace);
    }

    /**
     * Shows an error message with action buttons if validation is not allowed
     */
    static async showErrorIfNotAllowed(): Promise<boolean> {
        const check = await this.canValidate();
        
        if (!check.allowed) {
            const actions: string[] = [];
            
            if (check.canEnable) {
                actions.push('Enable Now');
            }
            actions.push('Open Settings');
            
            const choice = await vscode.window.showErrorMessage(
                `Unreal Planning Validator: ${check.reason}`,
                ...actions
            );
            
            if (choice === 'Enable Now') {
                await this.enable();
                return true; // Retry after enabling
            } else if (choice === 'Open Settings') {
                await vscode.commands.executeCommand('workbench.action.openSettings', 'unreal.planning.enabled');
            }
            
            return false;
        }
        
        return true;
    }
}

