import * as vscode from 'vscode';
import { ConnectionManager } from '../../ipc/connectionManager';
import { ConnectionState } from '../../state/connectionState';

export class ToolbarViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'unrealToolbarView';

    private _view?: vscode.WebviewView;
    private _connectionState: ConnectionState;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _connectionManager: ConnectionManager,
        connectionState: ConnectionState
    ) {
        this._connectionState = connectionState;
        
        // Update toolbar when state changes
        connectionState.onStateChanged(() => {
            this.updateToolbar();
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'executeCommand':
                        vscode.commands.executeCommand(message.commandId);
                        break;
                    case 'selectConfiguration':
                        this.showConfigurationMenu();
                        break;
                    case 'selectRunConfig':
                        this.showRunConfigMenu();
                        break;
                    case 'showMoreActions':
                        this.showMoreActionsMenu();
                        break;
                }
            }
        );

        // Initial update
        this.updateToolbar();
    }

    private updateToolbar() {
        if (!this._view) {
            return;
        }

        const state = {
            connected: this._connectionState.connected,
            buildInProgress: this._connectionState.buildInProgress,
            pieRunning: this._connectionState.pieRunning,
            piePaused: this._connectionState.piePaused || false,
            liveCodingCompiling: this._connectionState.liveCodingCompiling,
            capabilities: this._connectionState.capabilities || {}
        };

        this._view.webview.postMessage({
            type: 'updateState',
            state: state
        });
    }

    private async showConfigurationMenu() {
        const items = [
            { label: 'Development Editor', value: 'Development Editor' },
            { label: 'DebugGame Editor', value: 'DebugGame Editor' },
            { label: 'Shipping Editor', value: 'Shipping Editor' },
            { label: 'Test Editor', value: 'Test Editor' }
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select Configuration'
        });

        if (selected) {
            // TODO: Implement configuration change
            vscode.window.showInformationMessage(`Configuration: ${selected.label}`);
        }
    }

    private async showRunConfigMenu() {
        const items = [
            { label: 'Play In Editor (PIE)', value: 'pie' },
            { label: 'Standalone Game', value: 'standalone' },
            { label: 'Dedicated Server', value: 'server' }
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select Run Configuration'
        });

        if (selected) {
            if (selected.value === 'pie') {
                vscode.commands.executeCommand('unreal.run.playPIE');
            } else if (selected.value === 'standalone') {
                vscode.commands.executeCommand('unreal.run.standalone');
            } else if (selected.value === 'server') {
                vscode.commands.executeCommand('unreal.run.dedicatedServer');
            }
        }
    }

    private async showMoreActionsMenu() {
        const items = [
            { label: 'Start Profiling', command: 'unreal.profiling.start' },
            { label: 'Stop Profiling', command: 'unreal.profiling.stop' },
            { label: 'Open Performance Dashboard', command: 'unreal.profiling.openDashboard' },
            { label: 'Open Logs View', command: 'unreal.logs.open' },
            { label: 'Generate compile_commands.json', command: 'unreal.intellisense.generateCompileCommands' },
            { label: 'Generate Project Files', command: 'unreal.project.generateFiles' }
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'More Actions'
        });

        if (selected) {
            vscode.commands.executeCommand(selected.command);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'toolbarView.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'toolbarView.css')
        );

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    @import url('https://cdn.jsdelivr.net/npm/@vscode/codicons@0.0.35/dist/codicon.css');
                </style>
                <link href="${styleUri}" rel="stylesheet">
            </head>
            <body>
                <div class="toolbar-container">
                    <div class="toolbar-button" id="refreshBtn" data-command="unreal.project.refresh" title="Refresh Solution">
                        <span class="codicon codicon-refresh"></span>
                    </div>
                    <div class="toolbar-button" id="playBtn" data-command="unreal.run.playPIE" title="Start Play-In-Editor Session">
                        <span class="codicon codicon-play"></span>
                    </div>
                    <div class="toolbar-button" id="pauseBtn" data-command="unreal.run.pausePIE" title="Pause Play-In-Editor Session">
                        <span class="codicon codicon-debug-pause"></span>
                    </div>
                    <div class="toolbar-button" id="stopBtn" data-command="unreal.run.stopPIE" title="Stop Play-In-Editor Session">
                        <span class="codicon codicon-debug-stop"></span>
                    </div>
                    <div class="toolbar-button" id="settingsBtn" data-command="unreal.settings.open" title="Settings">
                        <span class="codicon codicon-settings-gear"></span>
                    </div>
                    <div class="toolbar-button" id="buildBtn" data-command="unreal.build.editor" title="Build">
                        <span class="codicon codicon-tools"></span>
                    </div>
                    <div class="toolbar-button dropdown" id="configBtn" title="Configuration/Target/Platform">
                        <span class="codicon codicon-list-selection"></span>
                        <span class="codicon codicon-chevron-down dropdown-arrow"></span>
                    </div>
                    <div class="toolbar-button dropdown" id="runConfigBtn" title="Run/Debug Configurations">
                        <span class="codicon codicon-debug-alt"></span>
                        <span class="codicon codicon-chevron-down dropdown-arrow"></span>
                    </div>
                    <div class="toolbar-button" id="runBtn" data-command="unreal.run.playPIE" title="Run">
                        <span class="codicon codicon-play"></span>
                    </div>
                    <div class="toolbar-button" id="debugBtn" data-command="unreal.debug.start" title="Debug">
                        <span class="codicon codicon-debug-start"></span>
                    </div>
                    <div class="toolbar-button dropdown" id="moreBtn" title="More Actions (Profiling etc)">
                        <span class="codicon codicon-ellipsis"></span>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

