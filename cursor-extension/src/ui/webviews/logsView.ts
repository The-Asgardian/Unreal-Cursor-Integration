import * as vscode from 'vscode';

// Placeholder for Phase 4: Real-time Logging
export class LogsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'unrealLogsView';

    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Unreal Logs</title>
            </head>
            <body>
                <h1>Unreal Engine Logs</h1>
                <p>Logs view will be implemented in Phase 4</p>
            </body>
            </html>`;
    }
}

