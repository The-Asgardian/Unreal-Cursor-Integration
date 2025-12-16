import { Plan, ValidationIssue, ValidationContext } from '../types';
import { ConnectionManager } from '../../ipc/connectionManager';

/**
 * Validates Unreal Engine API usage in the plan
 */
export class APIValidator {
    constructor(
        private connectionManager: ConnectionManager,
        private context: ValidationContext
    ) {}

    /**
     * Validate API usage in plan
     */
    async validate(plan: Plan): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        if (!this.context.connectionState?.connected) {
            issues.push({
                type: 'api',
                severity: 'warning',
                message: 'Cannot perform API validation: Unreal Editor not connected',
                suggestion: 'Connect to Unreal Editor to enable API validation'
            });
            return issues;
        }

        // Extract API calls from plan
        const apiCalls = this.extractAPICalls(plan);

        // Validate each API call
        for (const apiCall of apiCalls) {
            const apiIssues = await this.validateAPICall(apiCall);
            issues.push(...apiIssues);
        }

        // Check for thread safety issues
        const threadSafetyIssues = this.checkThreadSafety(plan);
        issues.push(...threadSafetyIssues);

        // Check for module dependencies
        const moduleIssues = await this.checkModuleDependencies(plan);
        issues.push(...moduleIssues);

        return issues;
    }

    /**
     * Extract API calls from plan
     */
    private extractAPICalls(plan: Plan): Array<{ name: string; type: string; location?: { file?: string; line?: number } }> {
        const apiCalls: Array<{ name: string; type: string; location?: { file?: string; line?: number } }> = [];

        // Extract from code snippets
        if (plan.codeSnippets) {
            for (const snippet of plan.codeSnippets) {
                if (snippet.language === 'cpp' || snippet.language === 'c++' || snippet.language === 'h' || snippet.language === 'hpp') {
                    // Look for common Unreal API patterns
                    const apiPatterns = [
                        /GEngine->(\w+)/g,
                        /GetWorld\(\)->(\w+)/g,
                        /GetGameInstance\(\)->(\w+)/g,
                        /UGameplayStatics::(\w+)/g,
                        /UBlueprintFunctionLibrary::(\w+)/g,
                        /FPlatformProcess::(\w+)/g,
                        /FPaths::(\w+)/g,
                        /FString::(\w+)/g,
                        /TArray<[^>]+>::(\w+)/g
                    ];

                    for (const pattern of apiPatterns) {
                        let match;
                        while ((match = pattern.exec(snippet.code)) !== null) {
                            apiCalls.push({
                                name: match[1],
                                type: 'function',
                                location: snippet.file ? { file: snippet.file } : undefined
                            });
                        }
                    }
                }
            }
        }

        return apiCalls;
    }

    /**
     * Validate a single API call
     */
    private async validateAPICall(apiCall: { name: string; type: string; location?: { file?: string; line?: number } }): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        try {
            // Try to find the API in reflection system
            const symbolResult = await this.connectionManager.sendRequest('reflection.findSymbol', {
                symbolName: apiCall.name
            });

            if (!symbolResult) {
                // API might still be valid (C++ only, not in reflection)
                // This is just a warning, not an error
                issues.push({
                    type: 'api',
                    severity: 'info',
                    message: `API call '${apiCall.name}' not found in reflection system`,
                    location: apiCall.location,
                    suggestion: 'Verify the API exists and is available in the current engine version'
                });
            }
        } catch (error) {
            // Ignore errors - API might be valid but not in reflection
        }

        return issues;
    }

    /**
     * Check for thread safety issues
     */
    private checkThreadSafety(plan: Plan): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (plan.codeSnippets) {
            for (const snippet of plan.codeSnippets) {
                if (snippet.language === 'cpp' || snippet.language === 'c++') {
                    const code = snippet.code;

                    // Check for Unreal API calls that require Game Thread
                    const gameThreadAPIs = [
                        'GEngine',
                        'GetWorld()',
                        'GetGameInstance()',
                        'UObject',
                        'AActor',
                        'UWorld',
                        'UGameplayStatics',
                        'CreateDefaultSubobject'
                    ];

                    // Check if code uses Game Thread APIs but doesn't marshal to Game Thread
                    const hasGameThreadAPI = gameThreadAPIs.some(api => code.includes(api));
                    const hasAsyncTask = code.includes('AsyncTask') || code.includes('ENamedThreads::GameThread');
                    const isInGameThreadFunction = code.includes('BeginPlay') || code.includes('Tick') || 
                                                   code.includes('Construct') || code.includes('InitializeComponent');

                    if (hasGameThreadAPI && !hasAsyncTask && !isInGameThreadFunction) {
                        // Check if this is in a background thread context
                        if (code.includes('Async') || code.includes('Thread') || code.includes('Task')) {
                            issues.push({
                                type: 'api',
                                severity: 'error',
                                message: 'Unreal API calls in background thread without Game Thread marshaling',
                                location: { file: snippet.file },
                                suggestion: 'Use AsyncTask(ENamedThreads::GameThread, [this]() { /* code */ }) to marshal to Game Thread'
                            });
                        }
                    }
                }
            }
        }

        return issues;
    }

    /**
     * Check module dependencies
     */
    private async checkModuleDependencies(plan: Plan): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        // Extract module names from code
        const modules = new Set<string>();

        if (plan.codeSnippets) {
            for (const snippet of plan.codeSnippets) {
                if (snippet.language === 'cpp' || snippet.language === 'c++' || snippet.language === 'h' || snippet.language === 'hpp') {
                    // Look for module API macros (e.g., MYMODULE_API)
                    const moduleMatch = snippet.code.match(/(\w+)_API\s+/);
                    if (moduleMatch) {
                        modules.add(moduleMatch[1]);
                    }

                    // Look for includes that suggest modules
                    const includeMatch = snippet.code.match(/#include\s+["<](.+?)\/(\w+)\.h[">]/g);
                    if (includeMatch) {
                        for (const include of includeMatch) {
                            const pathMatch = include.match(/(\w+)\/(\w+)\.h/);
                            if (pathMatch) {
                                modules.add(pathMatch[1]);
                            }
                        }
                    }
                }
            }
        }

        // Validate modules exist (would need to query build system)
        // For now, just note that modules were detected
        if (modules.size > 0) {
            issues.push({
                type: 'api',
                severity: 'info',
                message: `Detected modules: ${Array.from(modules).join(', ')}. Ensure these are listed in Build.cs files.`,
                suggestion: 'Verify module dependencies in your module\'s Build.cs file'
            });
        }

        return issues;
    }
}

