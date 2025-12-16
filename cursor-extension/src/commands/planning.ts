import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';
import { PlanningWorkspaceGuard } from '../planning/workspaceGuard';
import { PlanParser } from '../planning/planParser';
import { PlanValidator } from '../planning/planValidator';
import { Plan, ValidationResult } from '../planning/types';

/**
 * Register planning validation commands
 */
export function register(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    // Main validation command
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.planning.validate', async () => {
            await validatePlanCommand(connectionManager, connectionState);
        })
    );
}

/**
 * Main command handler for plan validation
 */
async function validatePlanCommand(
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
): Promise<void> {
    // Guard check
    const canProceed = await PlanningWorkspaceGuard.showErrorIfNotAllowed();
    if (!canProceed) {
        return;
    }

    // Check connection state (optional, but warn if not connected)
    if (!connectionState.connected) {
        const continueChoice = await vscode.window.showWarningMessage(
            'Unreal Editor not connected. Some validations may be limited. Continue with limited validation?',
            'Yes',
            'No'
        );

        if (continueChoice !== 'Yes') {
            return;
        }
    }

    // Get plan from user
    const plan = await getPlanFromUser();
    if (!plan) {
        return; // User cancelled
    }

    // Get max iterations from config
    const config = vscode.workspace.getConfiguration('unreal');
    const maxIterations = config.get<number>('planning.maxIterations', 5);

    // Show progress
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Validating Plan',
            cancellable: false
        },
        async (progress) => {
            progress.report({ increment: 0, message: 'Initializing validators...' });

            // Create validator
            const validator = new PlanValidator(connectionManager, connectionState);

            progress.report({ increment: 20, message: 'Validating plan...' });

            // Validate plan
            let validationResult: ValidationResult;
            try {
                validationResult = await validator.validatePlan(plan, maxIterations);
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
                return;
            }

            progress.report({ increment: 100, message: 'Complete' });

            // Show results (refined plan is already included in validationResult)
            await showValidationResults(validationResult, validationResult.refinedPlan);
        }
    );
}

/**
 * Get plan from user (clipboard or file selection)
 */
async function getPlanFromUser(): Promise<Plan | null> {
    const choice = await vscode.window.showQuickPick(
        ['From Clipboard', 'From File', 'Cancel'],
        {
            placeHolder: 'Select plan source'
        }
    );

    if (!choice || choice === 'Cancel') {
        return null;
    }

    if (choice === 'From Clipboard') {
        const clipboardText = await vscode.env.clipboard.readText();
        if (!clipboardText) {
            vscode.window.showErrorMessage('Clipboard is empty');
            return null;
        }

        try {
            // Try JSON first
            if (clipboardText.trim().startsWith('{')) {
                return PlanParser.parseJSON(clipboardText);
            } else {
                // Assume markdown
                return PlanParser.parseMarkdown(clipboardText);
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to parse plan: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            return null;
        }
    } else if (choice === 'From File') {
        const fileUri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'Plan Files': ['md', 'json', 'txt']
            }
        });

        if (!fileUri || fileUri.length === 0) {
            return null;
        }

        try {
            const fileContent = await vscode.workspace.fs.readFile(fileUri[0]);
            const text = Buffer.from(fileContent).toString('utf-8');

            if (fileUri[0].fsPath.endsWith('.json')) {
                return PlanParser.parseJSON(text);
            } else {
                return PlanParser.parseMarkdown(text);
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to read plan file: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            return null;
        }
    }

    return null;
}

/**
 * Show validation results to user
 */
async function showValidationResults(
    result: ValidationResult,
    refinedPlan?: Plan
): Promise<void> {
    // Create output channel
    const outputChannel = vscode.window.createOutputChannel('Unreal Planning Validator');
    outputChannel.show(true);

    // Write results
    outputChannel.appendLine('=== Plan Validation Results ===');
    outputChannel.appendLine(`Valid: ${result.valid ? 'Yes' : 'No'}`);
    outputChannel.appendLine(`Iterations: ${result.iterations}`);
    outputChannel.appendLine(`Issues Found: ${result.issues.length}`);
    outputChannel.appendLine('');

    if (result.skippedValidations && result.skippedValidations.length > 0) {
        outputChannel.appendLine(`Skipped Validations: ${result.skippedValidations.join(', ')}`);
        outputChannel.appendLine('');
    }

    if (result.warnings.length > 0) {
        outputChannel.appendLine('Warnings:');
        for (const warning of result.warnings) {
            outputChannel.appendLine(`  - ${warning}`);
        }
        outputChannel.appendLine('');
    }

    // Group issues by type
    const issuesByType = new Map<string, ValidationResult['issues']>();
    for (const issue of result.issues) {
        if (!issuesByType.has(issue.type)) {
            issuesByType.set(issue.type, []);
        }
        issuesByType.get(issue.type)!.push(issue);
    }

    // Write issues
    for (const [type, issues] of issuesByType) {
        outputChannel.appendLine(`${type.toUpperCase()} Issues (${issues.length}):`);
        for (const issue of issues) {
            outputChannel.appendLine(`  [${issue.severity.toUpperCase()}] ${issue.message}`);
            if (issue.location?.file) {
                outputChannel.appendLine(`    File: ${issue.location.file}`);
            }
            if (issue.location?.line) {
                outputChannel.appendLine(`    Line: ${issue.location.line}`);
            }
            if (issue.suggestion) {
                outputChannel.appendLine(`    Suggestion: ${issue.suggestion}`);
            }
            outputChannel.appendLine('');
        }
    }

    // Show summary
    const errorCount = result.issues.filter(i => i.severity === 'error').length;
    const warningCount = result.issues.filter(i => i.severity === 'warning').length;
    const infoCount = result.issues.filter(i => i.severity === 'info').length;

    const summary = `Summary: ${errorCount} errors, ${warningCount} warnings, ${infoCount} info`;
    
    if (result.valid) {
        vscode.window.showInformationMessage(`Plan validation complete. ${summary}`);
    } else {
        vscode.window.showWarningMessage(`Plan validation found issues. ${summary}`);
    }

    // Show refined plan if available
    if (refinedPlan) {
        const showRefined = await vscode.window.showInformationMessage(
            'Plan has been refined. Would you like to view the refined plan?',
            'View Refined Plan',
            'Dismiss'
        );

        if (showRefined === 'View Refined Plan') {
            // Create a new document with refined plan
            const doc = await vscode.workspace.openTextDocument({
                content: JSON.stringify(refinedPlan, null, 2),
                language: 'json'
            });
            await vscode.window.showTextDocument(doc);
        }
    }
}

