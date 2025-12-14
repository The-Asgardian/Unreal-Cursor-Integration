import * as vscode from 'vscode';
import { ConnectionManager } from '../../ipc/connectionManager';
import { ConnectionState } from '../../state/connectionState';

export interface BuildConfiguration {
    target: string;
    platform: string;
    configuration: string;
    extraArgs?: string[];
}

export interface BuildHistoryEntry {
    id: string;
    timestamp: number;
    config: BuildConfiguration;
    success: boolean;
    duration?: number;
    errorCount: number;
    warningCount: number;
}

export class BuildViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'unrealBuildView';

    private _view?: vscode.WebviewView;
    private _buildHistory: BuildHistoryEntry[] = [];
    private _currentBuild: {
        id?: string;
        config?: BuildConfiguration;
        progress?: number;
        phase?: string;
        output: string[];
        errors: number;
        warnings: number;
    } = {
        output: [],
        errors: 0,
        warnings: 0
    };

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _connectionManager: ConnectionManager,
        private readonly _connectionState: ConnectionState
    ) {
        // Subscribe to build events
        this.setupEventHandlers();
    }

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

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'startBuild':
                    await this.handleStartBuild(message.config);
                    break;
                case 'cancelBuild':
                    await this.handleCancelBuild();
                    break;
                case 'rebuild':
                    await this.handleRebuild(message.config);
                    break;
                case 'clean':
                    await this.handleClean(message.config);
                    break;
                case 'generateProjectFiles':
                    await this.handleGenerateProjectFiles();
                    break;
                case 'listTargets':
                    await this.handleListTargets();
                    break;
                case 'clearOutput':
                    this._currentBuild.output = [];
                    this._currentBuild.errors = 0;
                    this._currentBuild.warnings = 0;
                    this.updateWebview();
                    break;
            }
        });

        // Initial update
        this.updateWebview();
    }

    private setupEventHandlers(): void {
        const client = (this._connectionManager as any).client;
        if (!client) {
            // Wait for connection
            const disposable = this._connectionState.onStateChanged(() => {
                if (this._connectionState.connected) {
                    this.setupEventHandlers();
                    disposable.dispose();
                }
            });
            return;
        }

        client.onEvent('build.started', (_event: string, data: { buildId: string; target: string; configuration: string; platform: string }) => {
            this._currentBuild.id = data.buildId;
            this._currentBuild.config = {
                target: data.target,
                platform: data.platform,
                configuration: data.configuration
            };
            this._currentBuild.progress = 0;
            this._currentBuild.output = [];
            this._currentBuild.errors = 0;
            this._currentBuild.warnings = 0;
            this.updateWebview();
        });

        client.onEvent('build.progress', (_event: string, data: { buildId: string; percent: number; phase?: string }) => {
            if (this._currentBuild.id === data.buildId) {
                this._currentBuild.progress = data.percent;
                this._currentBuild.phase = data.phase;
                this.updateWebview();
            }
        });

        client.onEvent('build.outputLine', (_event: string, data: { buildId: string; line: string; category: string }) => {
            if (this._currentBuild.id === data.buildId) {
                this._currentBuild.output.push(data.line);
                if (data.category === 'Error') {
                    this._currentBuild.errors++;
                } else if (data.category === 'Warning') {
                    this._currentBuild.warnings++;
                }
                this.updateWebview();
            }
        });

        client.onEvent('build.finished', (_event: string, data: { buildId: string; success: boolean; duration?: number; error?: string }) => {
            if (this._currentBuild.id === data.buildId) {
                // Add to history
                if (this._currentBuild.config) {
                    this._buildHistory.unshift({
                        id: data.buildId,
                        timestamp: Date.now(),
                        config: this._currentBuild.config,
                        success: data.success,
                        duration: data.duration,
                        errorCount: this._currentBuild.errors,
                        warningCount: this._currentBuild.warnings
                    });
                    // Keep only last 50 builds
                    if (this._buildHistory.length > 50) {
                        this._buildHistory = this._buildHistory.slice(0, 50);
                    }
                }
                this._currentBuild.id = undefined;
                this._currentBuild.progress = undefined;
                this.updateWebview();
            }
        });

        client.onEvent('build.cancelled', (_event: string, data: { buildId: string }) => {
            if (this._currentBuild.id === data.buildId) {
                this._currentBuild.id = undefined;
                this._currentBuild.progress = undefined;
                this.updateWebview();
            }
        });
    }

    private async handleStartBuild(config: BuildConfiguration): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const projectPath = workspaceFolders?.[0]?.uri.fsPath || '';

            await this._connectionManager.sendRequest('build.start', {
                target: config.target,
                configuration: config.configuration,
                platform: config.platform,
                projectPath: projectPath,
                extraArgs: config.extraArgs || []
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start build: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleCancelBuild(): Promise<void> {
        if (this._currentBuild.id) {
            try {
                await this._connectionManager.sendRequest('build.cancel', { buildId: this._currentBuild.id });
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to cancel build: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
    }

    private async handleRebuild(config: BuildConfiguration): Promise<void> {
        await this.handleClean(config);
        // Wait a bit then start build
        setTimeout(() => {
            this.handleStartBuild(config);
        }, 500);
    }

    private async handleClean(config: BuildConfiguration): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const projectPath = workspaceFolders?.[0]?.uri.fsPath || '';

            await this._connectionManager.sendRequest('build.start', {
                target: config.target,
                configuration: config.configuration,
                platform: config.platform,
                projectPath: projectPath,
                extraArgs: ['-clean']
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to clean: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleGenerateProjectFiles(): Promise<void> {
        try {
            await this._connectionManager.sendRequest('project.generateFiles', {});
            vscode.window.showInformationMessage('Project files generated successfully');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to generate project files: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleListTargets(): Promise<void> {
        try {
            const result = await this._connectionManager.sendRequest('build.listTargets', {});
            // Update platform dropdown dynamically
            if (this._view && result.platforms) {
                this._view.webview.postMessage({
                    type: 'updatePlatforms',
                    platforms: result.platforms
                });
            }
            const message = `Targets: ${result.targets?.join(', ') || 'N/A'}\nConfigs: ${result.configurations?.join(', ') || 'N/A'}\nPlatforms: ${result.platforms?.join(', ') || 'N/A'}`;
            vscode.window.showInformationMessage(message);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to list targets: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async refreshPlatforms(): Promise<void> {
        await this.handleListTargets();
    }

    private updateWebview(): void {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'update',
                currentBuild: this._currentBuild,
                buildHistory: this._buildHistory,
                connected: this._connectionState.connected
            });
        }
    }

    private getInlineStyles(): string {
        return `
            .build-container {
                padding: 10px;
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-foreground);
            }
            .build-config-section {
                margin-bottom: 20px;
                padding: 15px;
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
            }
            .build-config-section h3 {
                margin-top: 0;
                margin-bottom: 15px;
                font-size: 14px;
                font-weight: 600;
            }
            .config-row {
                display: flex;
                align-items: center;
                margin-bottom: 10px;
            }
            .config-row label {
                width: 100px;
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
            }
            .config-row select {
                flex: 1;
                padding: 4px 8px;
                background-color: var(--vscode-dropdown-background);
                color: var(--vscode-dropdown-foreground);
                border: 1px solid var(--vscode-dropdown-border);
                border-radius: 2px;
                font-size: 12px;
            }
            .button-group {
                display: flex;
                gap: 8px;
                margin-top: 15px;
                flex-wrap: wrap;
            }
            .btn {
                padding: 6px 12px;
                border: none;
                border-radius: 2px;
                font-size: 12px;
                cursor: pointer;
                transition: opacity 0.2s;
            }
            .btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .btn-primary {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }
            .btn-primary:hover:not(:disabled) {
                background-color: var(--vscode-button-hoverBackground);
            }
            .btn-secondary {
                background-color: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }
            .btn-secondary:hover:not(:disabled) {
                background-color: var(--vscode-button-secondaryHoverBackground);
            }
            .btn-danger {
                background-color: var(--vscode-errorForeground);
                color: var(--vscode-button-foreground);
            }
            .btn-danger:hover:not(:disabled) {
                opacity: 0.8;
            }
            .btn-small {
                padding: 4px 8px;
                font-size: 11px;
            }
            .build-progress-section {
                margin-bottom: 20px;
                padding: 15px;
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
            }
            .build-progress-section h3 {
                margin-top: 0;
                margin-bottom: 15px;
                font-size: 14px;
                font-weight: 600;
            }
            .progress-bar-container {
                width: 100%;
                height: 20px;
                background-color: var(--vscode-progressBar-background);
                border-radius: 2px;
                overflow: hidden;
                margin-bottom: 10px;
            }
            .progress-bar {
                height: 100%;
                background-color: var(--vscode-progressBar-foreground);
                transition: width 0.3s ease;
                width: 0%;
            }
            .progress-text {
                display: flex;
                justify-content: space-between;
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
            }
            .build-stats {
                display: flex;
                gap: 15px;
                margin-top: 10px;
                font-size: 12px;
            }
            .stat {
                font-weight: 500;
            }
            .stat.error {
                color: var(--vscode-errorForeground);
            }
            .stat.warning {
                color: var(--vscode-textBlockQuote-border);
            }
            .build-output-section {
                margin-bottom: 20px;
                padding: 15px;
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
            }
            .output-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }
            .output-header h3 {
                margin: 0;
                font-size: 14px;
                font-weight: 600;
            }
            .output-container {
                max-height: 300px;
                overflow-y: auto;
                background-color: var(--vscode-textCodeBlock-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 2px;
                padding: 10px;
                font-family: var(--vscode-editor-font-family);
                font-size: 11px;
                line-height: 1.5;
            }
            .output-line {
                margin-bottom: 2px;
                word-wrap: break-word;
            }
            .output-line.error {
                color: var(--vscode-errorForeground);
            }
            .output-line.warning {
                color: var(--vscode-textBlockQuote-border);
            }
            .output-placeholder {
                color: var(--vscode-descriptionForeground);
                font-style: italic;
                text-align: center;
                padding: 20px;
            }
            .build-history-section {
                padding: 15px;
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
            }
            .build-history-section h3 {
                margin-top: 0;
                margin-bottom: 15px;
                font-size: 14px;
                font-weight: 600;
            }
            .history-container {
                max-height: 200px;
                overflow-y: auto;
            }
            .history-entry {
                padding: 8px;
                margin-bottom: 8px;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 2px;
                background-color: var(--vscode-textCodeBlock-background);
            }
            .history-entry.success {
                border-left: 3px solid var(--vscode-testing-iconPassed);
            }
            .history-entry.failed {
                border-left: 3px solid var(--vscode-errorForeground);
            }
            .history-header {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 5px;
                font-size: 12px;
            }
            .history-status {
                font-weight: 600;
                font-size: 14px;
            }
            .history-time {
                color: var(--vscode-descriptionForeground);
            }
            .history-duration {
                color: var(--vscode-descriptionForeground);
                margin-left: auto;
            }
            .history-details {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
            }
            .history-stats {
                display: flex;
                gap: 10px;
            }
            .history-stats .error {
                color: var(--vscode-errorForeground);
            }
            .history-stats .warning {
                color: var(--vscode-textBlockQuote-border);
            }
            .history-placeholder {
                color: var(--vscode-descriptionForeground);
                font-style: italic;
                text-align: center;
                padding: 20px;
            }
        `;
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    ${this.getInlineStyles()}
                </style>
                <title>Unreal Build Tools</title>
            </head>
            <body>
                <div class="build-container">
                    <div class="build-config-section">
                        <h3>Build Configuration</h3>
                        <div class="config-row">
                            <label>Target:</label>
                            <select id="targetSelect">
                                <option value="Editor">Editor</option>
                                <option value="Game">Game</option>
                            </select>
                        </div>
                        <div class="config-row">
                            <label>Platform:</label>
                            <select id="platformSelect">
                                <option value="Win64">Win64</option>
                            </select>
                        </div>
                        <div class="config-row">
                            <label>Configuration:</label>
                            <select id="configSelect">
                                <option value="Development" selected>Development</option>
                                <option value="Debug">Debug</option>
                                <option value="DebugGame">DebugGame</option>
                                <option value="Shipping">Shipping</option>
                                <option value="Test">Test</option>
                            </select>
                        </div>
                        <div class="button-group">
                            <button id="buildBtn" class="btn btn-primary">Build</button>
                            <button id="rebuildBtn" class="btn btn-secondary">Rebuild</button>
                            <button id="cleanBtn" class="btn btn-secondary">Clean</button>
                            <button id="cancelBtn" class="btn btn-danger" disabled>Cancel</button>
                        </div>
                        <div class="button-group">
                            <button id="generateFilesBtn" class="btn btn-secondary">Generate Project Files</button>
                        </div>
                    </div>

                    <div class="build-progress-section" id="progressSection" style="display: none;">
                        <h3>Build Progress</h3>
                        <div class="progress-info">
                            <div class="progress-bar-container">
                                <div class="progress-bar" id="progressBar"></div>
                            </div>
                            <div class="progress-text">
                                <span id="progressText">0%</span>
                                <span id="phaseText"></span>
                            </div>
                        </div>
                        <div class="build-stats">
                            <span class="stat error">Errors: <span id="errorCount">0</span></span>
                            <span class="stat warning">Warnings: <span id="warningCount">0</span></span>
                        </div>
                    </div>

                    <div class="build-output-section">
                        <div class="output-header">
                            <h3>Build Output</h3>
                            <button id="clearOutputBtn" class="btn btn-small">Clear</button>
                        </div>
                        <div class="output-container" id="outputContainer">
                            <div class="output-placeholder">No build output yet. Click Build to start.</div>
                        </div>
                    </div>

                    <div class="build-history-section">
                        <h3>Build History</h3>
                        <div class="history-container" id="historyContainer">
                            <div class="history-placeholder">No build history yet.</div>
                        </div>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    let currentBuild = null;
                    let buildHistory = [];
                    let connected = false;

                    // UI Elements
                    const targetSelect = document.getElementById('targetSelect');
                    const platformSelect = document.getElementById('platformSelect');
                    const configSelect = document.getElementById('configSelect');
                    const buildBtn = document.getElementById('buildBtn');
                    const rebuildBtn = document.getElementById('rebuildBtn');
                    const cleanBtn = document.getElementById('cleanBtn');
                    const cancelBtn = document.getElementById('cancelBtn');
                    const generateFilesBtn = document.getElementById('generateProjectFiles');
                    const clearOutputBtn = document.getElementById('clearOutputBtn');
                    const progressSection = document.getElementById('progressSection');
                    const progressBar = document.getElementById('progressBar');
                    const progressText = document.getElementById('progressText');
                    const phaseText = document.getElementById('phaseText');
                    const errorCount = document.getElementById('errorCount');
                    const warningCount = document.getElementById('warningCount');
                    const outputContainer = document.getElementById('outputContainer');
                    const historyContainer = document.getElementById('historyContainer');

                    // Event handlers
                    buildBtn.addEventListener('click', () => {
                        const config = getBuildConfig();
                        vscode.postMessage({ command: 'startBuild', config });
                    });

                    rebuildBtn.addEventListener('click', () => {
                        const config = getBuildConfig();
                        vscode.postMessage({ command: 'rebuild', config });
                    });

                    cleanBtn.addEventListener('click', () => {
                        const config = getBuildConfig();
                        vscode.postMessage({ command: 'clean', config });
                    });

                    cancelBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'cancelBuild' });
                    });

                    generateFilesBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'generateProjectFiles' });
                    });

                    clearOutputBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'clearOutput' });
                    });

                    function getBuildConfig() {
                        return {
                            target: targetSelect.value,
                            platform: platformSelect.value,
                            configuration: configSelect.value
                        };
                    }

                    function updateUI() {
                        // Update button states
                        const isBuilding = currentBuild && currentBuild.id;
                        buildBtn.disabled = !connected || isBuilding;
                        rebuildBtn.disabled = !connected || isBuilding;
                        cleanBtn.disabled = !connected || isBuilding;
                        cancelBtn.disabled = !connected || !isBuilding;
                        generateFilesBtn.disabled = !connected;

                        // Update progress
                        if (isBuilding && currentBuild.progress !== undefined) {
                            progressSection.style.display = 'block';
                            const percent = Math.round(currentBuild.progress);
                            progressBar.style.width = percent + '%';
                            progressText.textContent = percent + '%';
                            phaseText.textContent = currentBuild.phase ? ' - ' + currentBuild.phase : '';
                            errorCount.textContent = currentBuild.errors || 0;
                            warningCount.textContent = currentBuild.warnings || 0;
                        } else {
                            progressSection.style.display = 'none';
                        }

                        // Update output
                        if (currentBuild && currentBuild.output && currentBuild.output.length > 0) {
                            outputContainer.innerHTML = currentBuild.output.map(line => {
                                const isError = line.includes('Error:') || line.includes('error');
                                const isWarning = line.includes('Warning:') || line.includes('warning');
                                const className = isError ? 'error' : (isWarning ? 'warning' : '');
                                return '<div class="output-line ' + className + '">' + escapeHtml(line) + '</div>';
                            }).join('');
                            outputContainer.scrollTop = outputContainer.scrollHeight;
                        } else {
                            outputContainer.innerHTML = '<div class="output-placeholder">No build output yet. Click Build to start.</div>';
                        }

                        // Update history
                        if (buildHistory && buildHistory.length > 0) {
                            historyContainer.innerHTML = buildHistory.map(entry => {
                                const date = new Date(entry.timestamp);
                                const timeStr = date.toLocaleTimeString();
                                const durationStr = entry.duration ? entry.duration.toFixed(1) + 's' : 'N/A';
                                const statusIcon = entry.success ? '✓' : '✗';
                                const statusClass = entry.success ? 'success' : 'failed';
                                return \`
                                    <div class="history-entry \${statusClass}">
                                        <div class="history-header">
                                            <span class="history-status">\${statusIcon}</span>
                                            <span class="history-time">\${timeStr}</span>
                                            <span class="history-duration">\${durationStr}</span>
                                        </div>
                                        <div class="history-details">
                                            <span>\${entry.config.target} - \${entry.config.platform} - \${entry.config.configuration}</span>
                                            <span class="history-stats">
                                                \${entry.errorCount > 0 ? '<span class="error">\${entry.errorCount} errors</span>' : ''}
                                                \${entry.warningCount > 0 ? '<span class="warning">\${entry.warningCount} warnings</span>' : ''}
                                            </span>
                                        </div>
                                    </div>
                                \`;
                            }).join('');
                        } else {
                            historyContainer.innerHTML = '<div class="history-placeholder">No build history yet.</div>';
                        }
                    }

                    function escapeHtml(text) {
                        const div = document.createElement('div');
                        div.textContent = text;
                        return div.innerHTML;
                    }

                    // Listen for messages from extension
                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'update':
                                currentBuild = message.currentBuild;
                                buildHistory = message.buildHistory || [];
                                connected = message.connected;
                                updateUI();
                                break;
                            case 'updatePlatforms':
                                // Update platform dropdown
                                platformSelect.innerHTML = '';
                                if (message.platforms && message.platforms.length > 0) {
                                    message.platforms.forEach(platform => {
                                        const option = document.createElement('option');
                                        option.value = platform;
                                        option.textContent = platform;
                                        platformSelect.appendChild(option);
                                    });
                                }
                                break;
                        }
                    });

                    // Load platforms when connected
                    let lastConnectedState = false;
                    function checkAndLoadPlatforms() {
                        if (connected && !lastConnectedState) {
                            vscode.postMessage({ command: 'listTargets' });
                        }
                        lastConnectedState = connected;
                    }
                    
                    // Wrap updateUI to also check for platform loading
                    const originalUpdateUI = updateUI;
                    updateUI = function() {
                        originalUpdateUI();
                        checkAndLoadPlatforms();
                    };
                    
                    // Initial update
                    updateUI();
                </script>
            </body>
            </html>`;
    }
}

