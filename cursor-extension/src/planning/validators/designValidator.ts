import { Plan, ValidationIssue } from '../types';

/**
 * Validates plan against Unreal Engine design patterns and best practices
 */
export class DesignValidator {
    /**
     * Validate design patterns and best practices
     */
    async validate(plan: Plan): Promise<ValidationIssue[]> {
        const issues: ValidationIssue[] = [];

        // Check UObject lifecycle
        const lifecycleIssues = this.checkUObjectLifecycle(plan);
        issues.push(...lifecycleIssues);

        // Check module structure
        const moduleIssues = this.checkModuleStructure(plan);
        issues.push(...moduleIssues);

        // Check plugin architecture
        const pluginIssues = this.checkPluginArchitecture(plan);
        issues.push(...pluginIssues);

        // Check Blueprint integration patterns
        const blueprintIssues = this.checkBlueprintIntegration(plan);
        issues.push(...blueprintIssues);

        // Check replication patterns
        const replicationIssues = this.checkReplicationPatterns(plan);
        issues.push(...replicationIssues);

        // Check memory management
        const memoryIssues = this.checkMemoryManagement(plan);
        issues.push(...memoryIssues);

        return issues;
    }

    /**
     * Check UObject lifecycle patterns
     */
    private checkUObjectLifecycle(plan: Plan): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (plan.codeSnippets) {
            for (const snippet of plan.codeSnippets) {
                if (snippet.language === 'cpp' || snippet.language === 'c++' || snippet.language === 'h' || snippet.language === 'hpp') {
                    const code = snippet.code;

                    // Check if class inherits from UObject/AActor but missing lifecycle methods
                    const isUObject = code.includes('UCLASS') && (code.includes(': public UObject') || code.includes(': public AActor'));
                    
                    if (isUObject) {
                        // AActor should have BeginPlay
                        if (code.includes('AActor') && !code.includes('BeginPlay')) {
                            issues.push({
                                type: 'design',
                                severity: 'warning',
                                message: 'AActor-derived class should implement BeginPlay()',
                                location: { file: snippet.file },
                                suggestion: 'Add virtual void BeginPlay() override; to handle actor initialization'
                            });
                        }

                        // Check for proper initialization
                        if (code.includes('UCLASS') && !code.includes('Construct') && !code.includes('InitializeComponent')) {
                            issues.push({
                                type: 'design',
                                severity: 'info',
                                message: 'Consider implementing Construct() or InitializeComponent() for initialization',
                                location: { file: snippet.file },
                                suggestion: 'Use Construct() for UObject initialization or InitializeComponent() for component setup'
                            });
                        }
                    }
                }
            }
        }

        return issues;
    }

    /**
     * Check module structure (Public/Private separation)
     */
    private checkModuleStructure(plan: Plan): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (plan.fileChanges) {
            for (const change of plan.fileChanges) {
                const filePath = change.file.toLowerCase();
                
                // Check if header is in Private folder
                if (filePath.endsWith('.h') && filePath.includes('/private/')) {
                    issues.push({
                        type: 'design',
                        severity: 'error',
                        message: `Header file '${change.file}' should be in Public/ folder, not Private/`,
                        location: { file: change.file },
                        suggestion: 'Move header files to Public/ folder. Only .cpp files should be in Private/'
                    });
                }

                // Check if implementation is in Public folder
                if (filePath.endsWith('.cpp') && filePath.includes('/public/')) {
                    issues.push({
                        type: 'design',
                        severity: 'error',
                        message: `Implementation file '${change.file}' should be in Private/ folder, not Public/`,
                        location: { file: change.file },
                        suggestion: 'Move .cpp files to Private/ folder. Only .h files should be in Public/'
                    });
                }
            }
        }

        return issues;
    }

    /**
     * Check plugin architecture
     */
    private checkPluginArchitecture(plan: Plan): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Check if plan mentions plugin but doesn't include .uplugin file
        const mentionsPlugin = plan.overview.toLowerCase().includes('plugin') || 
                               plan.todos.some(t => t.content.toLowerCase().includes('plugin'));

        if (mentionsPlugin && plan.fileChanges) {
            const hasUPluginFile = plan.fileChanges.some(f => f.file.endsWith('.uplugin'));
            if (!hasUPluginFile) {
                issues.push({
                    type: 'design',
                    severity: 'warning',
                    message: 'Plugin implementation should include a .uplugin file',
                    suggestion: 'Create a .uplugin file to define plugin metadata and dependencies'
                });
            }
        }

        return issues;
    }

    /**
     * Check Blueprint integration patterns
     */
    private checkBlueprintIntegration(plan: Plan): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (plan.codeSnippets) {
            for (const snippet of plan.codeSnippets) {
                if (snippet.language === 'cpp' || snippet.language === 'c++' || snippet.language === 'h' || snippet.language === 'hpp') {
                    const code = snippet.code;

                    // Check for BlueprintCallable without const
                    const blueprintCallableMatch = code.match(/UFUNCTION\s*\([^)]*BlueprintCallable[^)]*\)\s+(?:virtual\s+)?(?:static\s+)?(?:inline\s+)?(?!const\s)\w+\s+(\w+)\s*\(/);
                    if (blueprintCallableMatch) {
                        const funcName = blueprintCallableMatch[1];
                        // Check if function mutates state
                        const funcBody = code.substring(code.indexOf(funcName));
                        if (!funcBody.includes('const') && (funcBody.includes('=') || funcBody.includes('++') || funcBody.includes('--'))) {
                            issues.push({
                                type: 'design',
                                severity: 'warning',
                                message: `BlueprintCallable function '${funcName}' should be const if it doesn't mutate state`,
                                location: { file: snippet.file },
                                suggestion: 'Add const qualifier to function if it doesn\'t modify object state'
                            });
                        }
                    }

                    // Check for BlueprintReadWrite on properties that shouldn't be writable
                    const blueprintReadWriteMatch = code.match(/UPROPERTY\s*\([^)]*BlueprintReadWrite[^)]*\)\s+[^;]+(\w+)\s*;/);
                    if (blueprintReadWriteMatch) {
                        const propName = blueprintReadWriteMatch[1];
                        // Check if property is critical (should be ReadOnly)
                        if (propName.toLowerCase().includes('health') || propName.toLowerCase().includes('score') || 
                            propName.toLowerCase().includes('state')) {
                            issues.push({
                                type: 'design',
                                severity: 'warning',
                                message: `Property '${propName}' might be better as BlueprintReadOnly for safety`,
                                location: { file: snippet.file },
                                suggestion: 'Consider using BlueprintReadOnly if Blueprints shouldn\'t modify this property directly'
                            });
                        }
                    }
                }
            }
        }

        return issues;
    }

    /**
     * Check replication patterns
     */
    private checkReplicationPatterns(plan: Plan): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (plan.codeSnippets) {
            for (const snippet of plan.codeSnippets) {
                if (snippet.language === 'cpp' || snippet.language === 'c++' || snippet.language === 'h' || snippet.language === 'hpp') {
                    const code = snippet.code;

                    // Check for replicated properties without OnRep functions
                    const replicatedPropMatch = code.match(/UPROPERTY\s*\([^)]*Replicated[^)]*\)\s+[^;]+(\w+)\s*;/);
                    if (replicatedPropMatch) {
                        const propName = replicatedPropMatch[1];
                        const onRepName = `OnRep_${propName}`;
                        
                        if (!code.includes(onRepName)) {
                            issues.push({
                                type: 'design',
                                severity: 'warning',
                                message: `Replicated property '${propName}' should have an OnRep function: ${onRepName}`,
                                location: { file: snippet.file },
                                suggestion: `Add UFUNCTION() void ${onRepName}(); to handle replication callbacks`
                            });
                        }
                    }

                    // Check for Server RPCs called from non-authority context
                    const serverRPCMatch = code.match(/UFUNCTION\s*\([^)]*Server[^)]*\)\s+[^;]+(\w+)\s*\(/);
                    if (serverRPCMatch) {
                        const funcName = serverRPCMatch[1];
                        // Check if called without authority check
                        if (!code.includes('HasAuthority') && !code.includes('GetLocalRole') && !code.includes('ROLE_Authority')) {
                            issues.push({
                                type: 'design',
                                severity: 'info',
                                message: `Server RPC '${funcName}' should verify authority before calling`,
                                location: { file: snippet.file },
                                suggestion: 'Add authority check before calling Server RPCs'
                            });
                        }
                    }
                }
            }
        }

        return issues;
    }

    /**
     * Check memory management patterns
     */
    private checkMemoryManagement(plan: Plan): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        if (plan.codeSnippets) {
            for (const snippet of plan.codeSnippets) {
                if (snippet.language === 'cpp' || snippet.language === 'c++') {
                    const code = snippet.code;

                    // Check for raw pointers that should be smart pointers
                    const rawPointerMatch = code.match(/(\w+)\s*\*\s*(\w+)\s*[=;]/);
                    if (rawPointerMatch && !code.includes('TSharedPtr') && !code.includes('TWeakPtr') && !code.includes('TUniquePtr')) {
                        const typeName = rawPointerMatch[1];
                        // UObject-derived types should use raw pointers (managed by GC)
                        // But non-UObject types should use smart pointers
                        if (!typeName.startsWith('U') && !typeName.startsWith('A') && !typeName.startsWith('F')) {
                            issues.push({
                                type: 'design',
                                severity: 'warning',
                                message: `Consider using smart pointer (TSharedPtr, TUniquePtr) instead of raw pointer for '${typeName}'`,
                                location: { file: snippet.file },
                                suggestion: 'Use TSharedPtr or TUniquePtr for better memory management'
                            });
                        }
                    }

                    // Check for manual new/delete (should use Unreal allocators)
                    if (code.includes('new ') && !code.includes('NewObject') && !code.includes('SpawnActor')) {
                        issues.push({
                            type: 'design',
                            severity: 'warning',
                            message: 'Consider using Unreal allocators (NewObject, SpawnActor) instead of new',
                            location: { file: snippet.file },
                            suggestion: 'Use NewObject<T>() for UObjects or SpawnActor<T>() for Actors'
                        });
                    }
                }
            }
        }

        return issues;
    }
}

