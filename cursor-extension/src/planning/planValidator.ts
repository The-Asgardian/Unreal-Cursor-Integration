import { Plan, ValidationResult, ValidationIssue, ValidationContext } from './types';
import { ReflectionValidator } from './validators/reflectionValidator';
import { IntelliSenseValidator } from './validators/intelliSenseValidator';
import { APIValidator } from './validators/apiValidator';
import { DesignValidator } from './validators/designValidator';
import { PlanRefiner } from './planRefiner';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';
import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Main validator orchestrator that coordinates all validation phases
 */
export class PlanValidator {
    private reflectionValidator: ReflectionValidator;
    private intelliSenseValidator: IntelliSenseValidator;
    private apiValidator: APIValidator;
    private designValidator: DesignValidator;
    private planRefiner: PlanRefiner;
    private context: ValidationContext;

    constructor(
        private connectionManager: ConnectionManager,
        private connectionState: ConnectionState
    ) {
        this.context = {
            connectionState: {
                connected: connectionState.connected,
                projectInfo: connectionState.projectInfo
            }
        };

        // Initialize validators
        this.reflectionValidator = new ReflectionValidator(connectionManager, this.context);
        this.intelliSenseValidator = new IntelliSenseValidator(connectionManager, this.context);
        this.apiValidator = new APIValidator(connectionManager, this.context);
        this.designValidator = new DesignValidator();
        this.planRefiner = new PlanRefiner();
    }

    /**
     * Validate plan across all validation phases
     */
    async validatePlan(plan: Plan, maxIterations: number = 5): Promise<ValidationResult> {
        let currentPlan = plan;
        let iterations = 0;
        const allIssues: ValidationIssue[] = [];
        const warnings: string[] = [];
        const skippedValidations: string[] = [];
        let refinedPlan: Plan | undefined;

        // Update context with compile commands path
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            this.context.compileCommandsPath = path.join(
                workspaceFolder.uri.fsPath,
                '.vscode',
                'compile_commands.json'
            );
        }

        // Update connection state in context
        this.context.connectionState = {
            connected: this.connectionState.connected,
            projectInfo: this.connectionState.projectInfo
        };

        while (iterations < maxIterations) {
            iterations++;
            const iterationIssues: ValidationIssue[] = [];

            // Run all validators
            try {
                const reflectionIssues = await this.validateReflection(currentPlan);
                iterationIssues.push(...reflectionIssues);
            } catch (error) {
                skippedValidations.push('reflection');
                warnings.push(`Reflection validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            try {
                const intelliSenseIssues = await this.validateIntelliSense(currentPlan);
                iterationIssues.push(...intelliSenseIssues);
            } catch (error) {
                skippedValidations.push('intellisense');
                warnings.push(`IntelliSense validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            try {
                const apiIssues = await this.validateAPI(currentPlan);
                iterationIssues.push(...apiIssues);
            } catch (error) {
                skippedValidations.push('api');
                warnings.push(`API validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            try {
                const designIssues = await this.validateDesign(currentPlan);
                iterationIssues.push(...designIssues);
            } catch (error) {
                skippedValidations.push('design');
                warnings.push(`Design validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }

            // Collect all issues (mark them as from this iteration)
            const iterationIssuesWithContext = iterationIssues.map(issue => ({
                ...issue,
                fixed: false // Reset fixed status for new iteration
            }));
            allIssues.push(...iterationIssuesWithContext);

            // Check if there are critical errors
            const criticalErrors = iterationIssues.filter(i => i.severity === 'error');
            const warningsOnly = iterationIssues.filter(i => i.severity !== 'error').length === iterationIssues.length;

            // If no issues at all, we're done
            if (iterationIssues.length === 0) {
                refinedPlan = currentPlan;
                break; // Validation complete
            }

            // If no critical errors and only warnings, we're done (warnings are acceptable)
            if (criticalErrors.length === 0 && warningsOnly) {
                refinedPlan = currentPlan;
                break; // Validation complete (only warnings remain)
            }

            // Refine plan if there are issues to fix (and we haven't reached max iterations)
            if (iterations < maxIterations) {
                const refinementResult = this.planRefiner.refinePlan(currentPlan, iterationIssues);
                
                if (refinementResult.issuesFixed > 0) {
                    // Use refined plan for next iteration
                    currentPlan = refinementResult.plan;
                    refinedPlan = currentPlan;
                    
                    // Mark fixed issues in the allIssues array
                    const fixedIssues = iterationIssues.filter(i => i.fixed);
                    for (const fixedIssue of fixedIssues) {
                        const issueIndex = allIssues.findIndex(
                            ai => ai.message === fixedIssue.message && 
                                  ai.location?.file === fixedIssue.location?.file &&
                                  ai.location?.line === fixedIssue.location?.line
                        );
                        if (issueIndex >= 0) {
                            allIssues[issueIndex].fixed = true;
                        }
                    }
                    
                    const fixedCount = refinementResult.issuesFixed;
                    const unfixedCount = refinementResult.issuesRemaining;
                    
                    warnings.push(`Iteration ${iterations}: Fixed ${fixedCount} issue(s), ${unfixedCount} issue(s) remain`);
                    
                    // Continue to next iteration with refined plan
                    continue;
                } else {
                    // No issues could be automatically fixed
                    refinedPlan = currentPlan;
                    warnings.push(`Iteration ${iterations}: No issues could be automatically fixed.`);
                    
                    // Continue anyway - maybe next iteration will find different issues
                    // or we'll hit max iterations
                    continue;
                }
            } else {
                // Reached max iterations
                warnings.push(`Reached maximum iterations (${maxIterations}). Some issues may remain.`);
                refinedPlan = currentPlan;
                break;
            }
        }

        // Determine if plan is valid (no errors, warnings are acceptable)
        const hasErrors = allIssues.some(i => i.severity === 'error' && !i.fixed);
        const valid = !hasErrors;

        return {
            valid,
            iterations,
            issues: allIssues,
            refinedPlan,
            warnings: Array.from(new Set(warnings)), // Remove duplicates
            skippedValidations: Array.from(new Set(skippedValidations))
        };
    }

    /**
     * Validate using reflection system
     */
    async validateReflection(plan: Plan): Promise<ValidationIssue[]> {
        return await this.reflectionValidator.validate(plan);
    }

    /**
     * Validate using IntelliSense
     */
    async validateIntelliSense(plan: Plan): Promise<ValidationIssue[]> {
        return await this.intelliSenseValidator.validate(plan);
    }

    /**
     * Validate API usage
     */
    async validateAPI(plan: Plan): Promise<ValidationIssue[]> {
        return await this.apiValidator.validate(plan);
    }

    /**
     * Validate design patterns
     */
    async validateDesign(plan: Plan): Promise<ValidationIssue[]> {
        return await this.designValidator.validate(plan);
    }
}

