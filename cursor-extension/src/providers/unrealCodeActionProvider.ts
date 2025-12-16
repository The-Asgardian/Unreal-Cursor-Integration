import * as vscode from 'vscode';
import { ConnectionManager } from '../ipc/connectionManager';
import { ConnectionState } from '../state/connectionState';

/**
 * Provides code actions (quick fixes) for Unreal Engine code
 */
export class UnrealCodeActionProvider implements vscode.CodeActionProvider {
    constructor(
        private connectionManager: ConnectionManager,
        private connectionState: ConnectionState
    ) {}

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeAction[]> {
        const actions: vscode.CodeAction[] = [];

        // Only work with C++ files
        const fileName = document.fileName.toLowerCase();
        if (!fileName.endsWith('.cpp') && !fileName.endsWith('.h') && !fileName.endsWith('.hpp')) {
            return actions;
        }

        // Get diagnostics in the range
        const diagnostics = context.diagnostics.filter(d => {
            if (d.source === 'Unreal UHT' || d.source === 'Unreal IntelliSense' || d.source === 'Unreal Build') {
                // Check if ranges intersect by checking if intersection exists
                const intersection = d.range.intersection(range);
                return intersection !== undefined;
            }
            return false;
        });

        for (const diagnostic of diagnostics) {
            // Fix 1: Missing UCLASS macro
            if (diagnostic.message.includes('UCLASS') || diagnostic.message.includes('missing UCLASS')) {
                const action = this.createAddUClassAction(document, range, diagnostic);
                if (action) actions.push(action);
            }

            // Fix 2: Missing UFUNCTION macro
            if (diagnostic.message.includes('UFUNCTION') || diagnostic.message.includes('missing UFUNCTION')) {
                const action = this.createAddUFunctionAction(document, range, diagnostic);
                if (action) actions.push(action);
            }

            // Fix 3: Missing UPROPERTY macro
            if (diagnostic.message.includes('UPROPERTY') || diagnostic.message.includes('missing UPROPERTY')) {
                const action = this.createAddUPropertyAction(document, range, diagnostic);
                if (action) actions.push(action);
            }

            // Fix 4: Missing include
            if (diagnostic.message.includes('Missing') && diagnostic.message.includes('include')) {
                const action = this.createAddIncludeAction(document, range, diagnostic);
                if (action) actions.push(action);
            }

            // Fix 5: Missing OnRep function
            if (diagnostic.message.includes('OnRep') || diagnostic.message.includes('replicated property')) {
                const action = this.createAddOnRepAction(document, range, diagnostic);
                if (action) actions.push(action);
            }

            // Fix 6: Thread safety - add AsyncTask
            if (diagnostic.message.includes('Game Thread') || diagnostic.message.includes('thread safety')) {
                const action = this.createAddAsyncTaskAction(document, range, diagnostic);
                if (action) actions.push(action);
            }

            // Fix 7: Add const qualifier
            if (diagnostic.message.includes('should be const') || diagnostic.message.includes('const')) {
                const action = this.createAddConstAction(document, range, diagnostic);
                if (action) actions.push(action);
            }
        }

        return actions;
    }

    private createAddUClassAction(
        document: vscode.TextDocument,
        range: vscode.Range,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | null {
        const line = document.lineAt(range.start.line);
        const text = line.text;

        // Find class declaration
        const classMatch = text.match(/class\s+([A-Z_]+_API\s+)?(\w+)/);
        if (!classMatch) return null;

        const action = new vscode.CodeAction(
            'Add UCLASS() macro',
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;

        // Find the module name from the API macro or file path
        let moduleName = '';
        if (classMatch[1]) {
            const moduleMatch = classMatch[1].match(/(\w+)_API/);
            if (moduleMatch) {
                moduleName = moduleMatch[1];
            }
        }

        if (!moduleName) {
            // Try to extract from file path
            const filePath = document.fileName;
            const sourceMatch = filePath.match(/Source[\/\\](\w+)[\/\\]/);
            if (sourceMatch) {
                moduleName = sourceMatch[1];
            }
        }

        const apiMacro = moduleName ? `${moduleName.toUpperCase()}_API` : '';
        const className = classMatch[2];

        action.edit = new vscode.WorkspaceEdit();
        const insertPosition = new vscode.Position(range.start.line, 0);
        action.edit.insert(document.uri, insertPosition, `UCLASS()\n`);

        return action;
    }

    private createAddUFunctionAction(
        document: vscode.TextDocument,
        range: vscode.Range,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | null {
        const line = document.lineAt(range.start.line);
        const text = line.text;

        // Find function declaration
        const funcMatch = text.match(/(\w+)\s+(\w+)\s*\(/);
        if (!funcMatch) return null;

        const action = new vscode.CodeAction(
            'Add UFUNCTION() macro',
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;

        // Determine if it should be BlueprintCallable
        const shouldBeBlueprint = text.includes('Blueprint') || diagnostic.message.includes('Blueprint');

        const macro = shouldBeBlueprint ? 'UFUNCTION(BlueprintCallable)' : 'UFUNCTION()';

        action.edit = new vscode.WorkspaceEdit();
        const insertPosition = new vscode.Position(range.start.line, 0);
        action.edit.insert(document.uri, insertPosition, `${macro}\n`);

        return action;
    }

    private createAddUPropertyAction(
        document: vscode.TextDocument,
        range: vscode.Range,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | null {
        const line = document.lineAt(range.start.line);
        const text = line.text;

        // Find property declaration
        const propMatch = text.match(/(\w+)\s+(\w+)\s*[;=]/);
        if (!propMatch) return null;

        const action = new vscode.CodeAction(
            'Add UPROPERTY() macro',
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;

        // Determine property flags
        let flags = 'EditAnywhere';
        if (diagnostic.message.includes('Blueprint')) {
            flags = 'BlueprintReadWrite';
        } else if (diagnostic.message.includes('Replicated')) {
            flags = 'Replicated';
        }

        action.edit = new vscode.WorkspaceEdit();
        const insertPosition = new vscode.Position(range.start.line, 0);
        action.edit.insert(document.uri, insertPosition, `UPROPERTY(${flags})\n`);

        return action;
    }

    private createAddIncludeAction(
        document: vscode.TextDocument,
        range: vscode.Range,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | null {
        // Extract include name from diagnostic message
        const includeMatch = diagnostic.message.match(/#include\s+[<"](.+?)[>"]/);
        if (!includeMatch) {
            // Try to extract from common patterns
            if (diagnostic.message.includes('CoreMinimal')) {
                return this.createSpecificIncludeAction(document, range, diagnostic, 'CoreMinimal.h', true);
            }
            return null;
        }

        const includePath = includeMatch[1];
        const useQuotes = includePath.endsWith('.h') && !includePath.startsWith('Engine/');
        return this.createSpecificIncludeAction(document, range, diagnostic, includePath, useQuotes);
    }

    private createSpecificIncludeAction(
        document: vscode.TextDocument,
        range: vscode.Range,
        diagnostic: vscode.Diagnostic,
        includePath: string,
        useQuotes: boolean
    ): vscode.CodeAction {
        const action = new vscode.CodeAction(
            `Add #include ${includePath}`,
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;

        // Find the first line (after any existing includes)
        let insertLine = 0;
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            if (line.text.trim().startsWith('#include')) {
                insertLine = i + 1;
            } else if (line.text.trim() && !line.text.trim().startsWith('//') && !line.text.trim().startsWith('/*')) {
                break;
            }
        }

        const include = useQuotes ? `#include "${includePath}"` : `#include <${includePath}>`;
        action.edit = new vscode.WorkspaceEdit();
        const insertPosition = new vscode.Position(insertLine, 0);
        action.edit.insert(document.uri, insertPosition, `${include}\n`);

        return action;
    }

    private createAddOnRepAction(
        document: vscode.TextDocument,
        range: vscode.Range,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | null {
        // Extract property name from diagnostic
        const propMatch = diagnostic.message.match(/property\s+['"]?(\w+)/i);
        if (!propMatch) return null;

        const propName = propMatch[1];
        const onRepName = `OnRep_${propName}`;

        const action = new vscode.CodeAction(
            `Add OnRep function: ${onRepName}`,
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];

        // Find a good place to insert (after the property, in the class)
        const line = document.lineAt(range.start.line);
        const insertLine = range.start.line + 1;

        const onRepFunction = `\n\tUFUNCTION()\n\tvirtual void ${onRepName}();\n`;

        action.edit = new vscode.WorkspaceEdit();
        const insertPosition = new vscode.Position(insertLine, 0);
        action.edit.insert(document.uri, insertPosition, onRepFunction);

        return action;
    }

    private createAddAsyncTaskAction(
        document: vscode.TextDocument,
        range: vscode.Range,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | null {
        const action = new vscode.CodeAction(
            'Wrap in AsyncTask for Game Thread',
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];

        // Get the selected code
        const selectedText = document.getText(range);
        if (!selectedText.trim()) return null;

        const wrappedCode = `AsyncTask(ENamedThreads::GameThread, [this]() {\n\t${selectedText.split('\n').join('\n\t')}\n});`;

        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, range, wrappedCode);

        return action;
    }

    private createAddConstAction(
        document: vscode.TextDocument,
        range: vscode.Range,
        diagnostic: vscode.Diagnostic
    ): vscode.CodeAction | null {
        const line = document.lineAt(range.start.line);
        const text = line.text;

        // Find function declaration
        const funcMatch = text.match(/(\w+)\s+(\w+)\s*\(([^)]*)\)/);
        if (!funcMatch || text.includes('const')) return null;

        const action = new vscode.CodeAction(
            'Add const qualifier',
            vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];

        // Add const before the semicolon or opening brace
        const constPosition = text.lastIndexOf(')');
        if (constPosition === -1) return null;

        const newText = text.substring(0, constPosition + 1) + ' const' + text.substring(constPosition + 1);

        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, line.range, newText);

        return action;
    }
}

