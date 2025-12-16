import { Plan, ValidationIssue, RefinementResult, RefinementChange } from './types';

/**
 * Automatically refines plans based on validation issues
 */
export class PlanRefiner {
    /**
     * Refine plan by fixing validation issues
     */
    refinePlan(plan: Plan, issues: ValidationIssue[]): RefinementResult {
        const refinedPlan: Plan = {
            ...plan,
            todos: [...plan.todos],
            fileChanges: plan.fileChanges ? [...plan.fileChanges] : [],
            codeSnippets: plan.codeSnippets ? [...plan.codeSnippets] : []
        };

        const changes: RefinementChange[] = [];
        let issuesFixed = 0;
        const issuesRemaining = issues.filter(i => !i.fixed).length;

        // Sort issues by severity (errors first)
        const sortedIssues = [...issues].sort((a, b) => {
            const severityOrder = { error: 0, warning: 1, info: 2 };
            return severityOrder[a.severity] - severityOrder[b.severity];
        });

        // Fix issues
        for (const issue of sortedIssues) {
            if (issue.fixed) {
                continue; // Already fixed
            }

            const fixResult = this.fixIssue(issue, refinedPlan);
            if (fixResult.fixed) {
                changes.push(fixResult.change);
                issuesFixed++;
                issue.fixed = true;
            }
        }

        return {
            plan: refinedPlan,
            changes,
            issuesFixed,
            issuesRemaining
        };
    }

    /**
     * Attempt to fix a single issue
     */
    private fixIssue(issue: ValidationIssue, plan: Plan): { fixed: boolean; change: RefinementChange } {
        const change: RefinementChange = {
            type: 'modify',
            target: 'code',
            description: issue.message,
            before: issue.originalCode,
            after: issue.suggestedCode
        };

        // Only fix issues with suggestions
        if (!issue.suggestion && !issue.suggestedCode) {
            return { fixed: false, change };
        }

        // Fix based on issue type
        switch (issue.type) {
            case 'intellisense':
                return this.fixIntelliSenseIssue(issue, plan, change);
            case 'reflection':
                return this.fixReflectionIssue(issue, plan, change);
            case 'api':
                return this.fixAPIIssue(issue, plan, change);
            case 'design':
                return this.fixDesignIssue(issue, plan, change);
            default:
                return { fixed: false, change };
        }
    }

    /**
     * Fix IntelliSense issues
     */
    private fixIntelliSenseIssue(issue: ValidationIssue, plan: Plan, change: RefinementChange): { fixed: boolean; change: RefinementChange } {
        if (!plan.codeSnippets || !issue.location?.file) {
            return { fixed: false, change };
        }

        for (const snippet of plan.codeSnippets) {
            if (snippet.file === issue.location.file || snippet.file?.endsWith(issue.location.file || '')) {
                let fixed = false;

                // Fix missing includes
                if (issue.message.includes('Missing') && issue.message.includes('include')) {
                    const includeLine = issue.suggestion?.match(/#include\s+[<"].+?[>"]/) || 
                                       issue.message.match(/#include\s+[<"].+?[>"]/);
                    if (includeLine) {
                        snippet.code = includeLine[0] + '\n' + snippet.code;
                        fixed = true;
                        change.after = snippet.code;
                    }
                }

                // Fix missing macros
                if (issue.message.includes('missing') && issue.message.includes('macro')) {
                    if (issue.message.includes('UCLASS')) {
                        const classMatch = snippet.code.match(/class\s+[A-Z_]+\s+API\s+(\w+)/);
                        if (classMatch) {
                            snippet.code = snippet.code.replace(
                                /class\s+[A-Z_]+\s+API\s+(\w+)/,
                                'UCLASS()\nclass $1_API $1'
                            );
                            fixed = true;
                            change.after = snippet.code;
                        }
                    } else if (issue.message.includes('UFUNCTION')) {
                        const funcMatch = snippet.code.match(/(\w+)\s+(\w+)\s*\(/);
                        if (funcMatch) {
                            snippet.code = snippet.code.replace(
                                /(\w+)\s+(\w+)\s*\(/,
                                'UFUNCTION(BlueprintCallable)\n$1 $2('
                            );
                            fixed = true;
                            change.after = snippet.code;
                        }
                    }
                }

                if (fixed) {
                    return { fixed: true, change };
                }
            }
        }

        return { fixed: false, change };
    }

    /**
     * Fix reflection issues
     */
    private fixReflectionIssue(issue: ValidationIssue, plan: Plan, change: RefinementChange): { fixed: boolean; change: RefinementChange } {
        // Reflection issues usually require manual fixes (wrong class names, etc.)
        // Just document the issue
        if (plan.todos && issue.suggestion) {
            // Add a todo to fix the issue
            plan.todos.push({
                id: `fix-${issue.location?.symbol || 'reflection'}-${Date.now()}`,
                content: `Fix reflection issue: ${issue.message}. ${issue.suggestion}`,
                status: 'pending'
            });
            change.type = 'add';
            change.target = 'todo';
            change.description = `Added todo to fix: ${issue.message}`;
            return { fixed: true, change };
        }

        return { fixed: false, change };
    }

    /**
     * Fix API issues
     */
    private fixAPIIssue(issue: ValidationIssue, plan: Plan, change: RefinementChange): { fixed: boolean; change: RefinementChange } {
        // Thread safety fixes
        if (issue.message.includes('Game Thread') && issue.suggestion) {
            if (plan.codeSnippets) {
                for (const snippet of plan.codeSnippets) {
                    if (snippet.file === issue.location?.file) {
                        // Add AsyncTask wrapper
                        const asyncTaskCode = `AsyncTask(ENamedThreads::GameThread, [this]() {\n    ${snippet.code}\n});`;
                        snippet.code = asyncTaskCode;
                        change.after = snippet.code;
                        return { fixed: true, change };
                    }
                }
            }
        }

        return { fixed: false, change };
    }

    /**
     * Fix design issues
     */
    private fixDesignIssue(issue: ValidationIssue, plan: Plan, change: RefinementChange): { fixed: boolean; change: RefinementChange } {
        // Most design issues require manual review
        // Add suggestions as todos
        if (plan.todos && issue.suggestion) {
            plan.todos.push({
                id: `design-${issue.type}-${Date.now()}`,
                content: `Design improvement: ${issue.message}. ${issue.suggestion}`,
                status: 'pending'
            });
            change.type = 'add';
            change.target = 'todo';
            change.description = `Added design improvement todo: ${issue.message}`;
            return { fixed: true, change };
        }

        return { fixed: false, change };
    }
}

