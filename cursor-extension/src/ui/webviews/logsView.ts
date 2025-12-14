import * as vscode from 'vscode';
import { ConnectionManager } from '../../ipc/connectionManager';
import { ConnectionState } from '../../state/connectionState';

export interface LogEntry {
    timestamp: string;
    frame: number;
    category: string;
    verbosity: string;
    message: string;
    file?: string;
    line?: number;
}

export class LogsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'unrealLogsView';

    private _view?: vscode.WebviewView;
    private _logs: LogEntry[] = [];
    private _maxLogs: number = 10000;
    private _isPaused: boolean = false;
    private _filters: {
        categories: string[];
        verbosity: string;
        search: string;
    } = {
        categories: [],
        verbosity: 'All',
        search: ''
    };
    private _isSubscribed: boolean = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _connectionManager: ConnectionManager,
        private readonly _connectionState: ConnectionState
    ) {
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
                case 'subscribe':
                    await this.handleSubscribe(message.filters);
                    break;
                case 'unsubscribe':
                    await this.handleUnsubscribe();
                    break;
                case 'clear':
                    await this.handleClear();
                    break;
                case 'pause':
                    this._isPaused = !this._isPaused;
                    this.updateWebview();
                    break;
                case 'setFilters':
                    this._filters = message.filters;
                    this.updateWebview();
                    break;
                case 'export':
                    await this.handleExport();
                    break;
            }
        });

        // Auto-subscribe when connected
        if (this._connectionState.connected) {
            this.autoSubscribe();
        } else {
            const disposable = this._connectionState.onStateChanged(() => {
                if (this._connectionState.connected && !this._isSubscribed) {
                    this.autoSubscribe();
                    disposable.dispose();
                }
            });
        }

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

        client.onEvent('logs.line', (_event: string, data: LogEntry) => {
            if (!this._isPaused) {
                this._logs.push(data);
                
                // Limit log history
                if (this._logs.length > this._maxLogs) {
                    this._logs = this._logs.slice(-this._maxLogs);
                }
                
                this.updateWebview();
            }
        });
    }

    private async autoSubscribe(): Promise<void> {
        // Subscribe to all logs by default
        await this.handleSubscribe({
            categories: [],
            verbosity: 'All',
            search: ''
        });
    }

    private async handleSubscribe(filters: any): Promise<void> {
        try {
            this._filters = filters;
            await this._connectionManager.sendRequest('logs.subscribe', {
                categories: filters.categories || [],
                verbosity: filters.verbosity === 'All' ? '' : filters.verbosity,
                search: filters.search || ''
            });
            this._isSubscribed = true;
            this.updateWebview();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to subscribe to logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleUnsubscribe(): Promise<void> {
        try {
            await this._connectionManager.sendRequest('logs.unsubscribe', {});
            this._isSubscribed = false;
            this.updateWebview();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to unsubscribe from logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleClear(): Promise<void> {
        this._logs = [];
        this.updateWebview();
    }

    private async handleExport(): Promise<void> {
        try {
            const result = await this._connectionManager.sendRequest('logs.export', {
                filters: this._filters,
                timeRange: {}
            });
            
            const jsonStr = JSON.stringify(result.logs || this._logs, null, 2);
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('unreal-logs.json'),
                filters: {
                    'JSON': ['json']
                }
            });
            
            if (uri) {
                const fs = require('fs');
                fs.writeFileSync(uri.fsPath, jsonStr, 'utf8');
                vscode.window.showInformationMessage('Logs exported successfully');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to export logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private updateWebview(): void {
        if (this._view) {
            // Apply filters to logs
            const filteredLogs = this.applyFilters(this._logs);
            
            this._view.webview.postMessage({
                type: 'update',
                logs: filteredLogs,
                isPaused: this._isPaused,
                isSubscribed: this._isSubscribed,
                filters: this._filters,
                connected: this._connectionState.connected,
                totalLogs: this._logs.length
            });
        }
    }

    private applyFilters(logs: LogEntry[]): LogEntry[] {
        return logs.filter(log => {
            // Category filter
            if (this._filters.categories.length > 0) {
                const matchesCategory = this._filters.categories.some(cat => 
                    log.category.toLowerCase().includes(cat.toLowerCase())
                );
                if (!matchesCategory) {
                    return false;
                }
            }
            
            // Verbosity filter
            if (this._filters.verbosity !== 'All') {
                if (log.verbosity !== this._filters.verbosity) {
                    return false;
                }
            }
            
            // Search filter
            if (this._filters.search) {
                const searchLower = this._filters.search.toLowerCase();
                if (!log.message.toLowerCase().includes(searchLower) &&
                    !log.category.toLowerCase().includes(searchLower)) {
                    return false;
                }
            }
            
            return true;
        });
    }

    private getInlineStyles(): string {
        return `
            body {
                margin: 0;
                padding: 0;
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-foreground);
            }
            .logs-container {
                display: flex;
                flex-direction: column;
                height: 100vh;
            }
            .logs-toolbar {
                padding: 8px;
                background-color: var(--vscode-editor-background);
                border-bottom: 1px solid var(--vscode-panel-border);
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
                align-items: center;
            }
            .toolbar-group {
                display: flex;
                gap: 4px;
                align-items: center;
            }
            .toolbar-group label {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
            }
            .toolbar-group select,
            .toolbar-group input {
                padding: 2px 6px;
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 2px;
                font-size: 11px;
            }
            .toolbar-group input {
                width: 150px;
            }
            .btn {
                padding: 4px 8px;
                border: none;
                border-radius: 2px;
                font-size: 11px;
                cursor: pointer;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }
            .btn:hover:not(:disabled) {
                background-color: var(--vscode-button-hoverBackground);
            }
            .btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .btn-secondary {
                background-color: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }
            .btn-secondary:hover:not(:disabled) {
                background-color: var(--vscode-button-secondaryHoverBackground);
            }
            .logs-content {
                flex: 1;
                overflow-y: auto;
                background-color: var(--vscode-textCodeBlock-background);
                font-family: var(--vscode-editor-font-family);
                font-size: 11px;
                line-height: 1.4;
            }
            .log-entry {
                padding: 2px 8px;
                border-bottom: 1px solid var(--vscode-panel-border);
                display: flex;
                gap: 8px;
            }
            .log-entry:hover {
                background-color: var(--vscode-list-hoverBackground);
            }
            .log-timestamp {
                color: var(--vscode-descriptionForeground);
                min-width: 80px;
                font-size: 10px;
            }
            .log-category {
                color: var(--vscode-textLink-foreground);
                min-width: 100px;
                font-weight: 500;
            }
            .log-verbosity {
                min-width: 70px;
                font-weight: 600;
            }
            .log-verbosity.fatal,
            .log-verbosity.error {
                color: var(--vscode-errorForeground);
            }
            .log-verbosity.warning {
                color: var(--vscode-textBlockQuote-border);
            }
            .log-verbosity.display,
            .log-verbosity.log {
                color: var(--vscode-foreground);
            }
            .log-verbosity.verbose,
            .log-verbosity.veryverbose {
                color: var(--vscode-descriptionForeground);
            }
            .log-message {
                flex: 1;
                word-wrap: break-word;
            }
            .status-bar {
                padding: 4px 8px;
                background-color: var(--vscode-editor-background);
                border-top: 1px solid var(--vscode-panel-border);
                font-size: 10px;
                color: var(--vscode-descriptionForeground);
                display: flex;
                justify-content: space-between;
            }
            .status-item {
                margin-right: 15px;
            }
            .status-item.active {
                color: var(--vscode-textLink-foreground);
            }
            .status-item.paused {
                color: var(--vscode-textBlockQuote-border);
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
                <title>Unreal Engine Logs</title>
            </head>
            <body>
                <div class="logs-container">
                    <div class="logs-toolbar">
                        <div class="toolbar-group">
                            <button id="subscribeBtn" class="btn">Subscribe</button>
                            <button id="unsubscribeBtn" class="btn btn-secondary">Unsubscribe</button>
                        </div>
                        <div class="toolbar-group">
                            <label>Verbosity:</label>
                            <select id="verbositySelect">
                                <option value="All">All</option>
                                <option value="Fatal">Fatal</option>
                                <option value="Error">Error</option>
                                <option value="Warning">Warning</option>
                                <option value="Display">Display</option>
                                <option value="Log">Log</option>
                                <option value="Verbose">Verbose</option>
                                <option value="VeryVerbose">VeryVerbose</option>
                            </select>
                        </div>
                        <div class="toolbar-group">
                            <label>Search:</label>
                            <input type="text" id="searchInput" placeholder="Search logs...">
                        </div>
                        <div class="toolbar-group">
                            <button id="pauseBtn" class="btn btn-secondary">Pause</button>
                            <button id="clearBtn" class="btn btn-secondary">Clear</button>
                            <button id="exportBtn" class="btn btn-secondary">Export</button>
                        </div>
                    </div>
                    <div class="logs-content" id="logsContent">
                        <div style="padding: 20px; text-align: center; color: var(--vscode-descriptionForeground);">
                            Waiting for logs...
                        </div>
                    </div>
                    <div class="status-bar">
                        <div>
                            <span class="status-item" id="statusConnected">Disconnected</span>
                            <span class="status-item" id="statusSubscribed">Not Subscribed</span>
                            <span class="status-item" id="statusPaused"></span>
                        </div>
                        <div>
                            <span class="status-item">Total: <span id="totalLogs">0</span></span>
                            <span class="status-item">Filtered: <span id="filteredLogs">0</span></span>
                        </div>
                    </div>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    let logs = [];
                    let isPaused = false;
                    let isSubscribed = false;
                    let connected = false;
                    let filters = { categories: [], verbosity: 'All', search: '' };

                    const subscribeBtn = document.getElementById('subscribeBtn');
                    const unsubscribeBtn = document.getElementById('unsubscribeBtn');
                    const pauseBtn = document.getElementById('pauseBtn');
                    const clearBtn = document.getElementById('clearBtn');
                    const exportBtn = document.getElementById('exportBtn');
                    const verbositySelect = document.getElementById('verbositySelect');
                    const searchInput = document.getElementById('searchInput');
                    const logsContent = document.getElementById('logsContent');
                    const statusConnected = document.getElementById('statusConnected');
                    const statusSubscribed = document.getElementById('statusSubscribed');
                    const statusPaused = document.getElementById('statusPaused');
                    const totalLogs = document.getElementById('totalLogs');
                    const filteredLogs = document.getElementById('filteredLogs');

                    subscribeBtn.addEventListener('click', () => {
                        vscode.postMessage({ 
                            command: 'subscribe', 
                            filters: {
                                categories: [],
                                verbosity: verbositySelect.value,
                                search: searchInput.value
                            }
                        });
                    });

                    unsubscribeBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'unsubscribe' });
                    });

                    pauseBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'pause' });
                    });

                    clearBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'clear' });
                    });

                    exportBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'export' });
                    });

                    verbositySelect.addEventListener('change', () => {
                        filters.verbosity = verbositySelect.value;
                        vscode.postMessage({ command: 'setFilters', filters });
                    });

                    searchInput.addEventListener('input', () => {
                        filters.search = searchInput.value;
                        vscode.postMessage({ command: 'setFilters', filters });
                    });

                    function escapeHtml(text) {
                        const div = document.createElement('div');
                        div.textContent = text;
                        return div.innerHTML;
                    }

                    function getVerbosityClass(verbosity) {
                        return verbosity.toLowerCase().replace('very', 'very');
                    }

                    function updateUI() {
                        // Update status
                        statusConnected.textContent = connected ? 'Connected' : 'Disconnected';
                        statusConnected.className = 'status-item ' + (connected ? 'active' : '');
                        statusSubscribed.textContent = isSubscribed ? 'Subscribed' : 'Not Subscribed';
                        statusSubscribed.className = 'status-item ' + (isSubscribed ? 'active' : '');
                        statusPaused.textContent = isPaused ? 'Paused' : '';
                        statusPaused.className = 'status-item ' + (isPaused ? 'paused' : '');
                        pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';

                        // Update button states
                        subscribeBtn.disabled = !connected || isSubscribed;
                        unsubscribeBtn.disabled = !connected || !isSubscribed;

                        // Update logs display
                        if (logs.length === 0) {
                            logsContent.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--vscode-descriptionForeground);">No logs to display</div>';
                        } else {
                            logsContent.innerHTML = logs.map(log => {
                                const verbosityClass = getVerbosityClass(log.verbosity);
                                return \`
                                    <div class="log-entry">
                                        <span class="log-timestamp">\${log.timestamp}</span>
                                        <span class="log-category">\${escapeHtml(log.category)}</span>
                                        <span class="log-verbosity \${verbosityClass}">\${escapeHtml(log.verbosity)}</span>
                                        <span class="log-message">\${escapeHtml(log.message)}</span>
                                    </div>
                                \`;
                            }).join('');
                            // Auto-scroll to bottom
                            logsContent.scrollTop = logsContent.scrollHeight;
                        }

                        filteredLogs.textContent = logs.length;
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'update':
                                logs = message.logs || [];
                                isPaused = message.isPaused || false;
                                isSubscribed = message.isSubscribed || false;
                                connected = message.connected || false;
                                filters = message.filters || filters;
                                totalLogs.textContent = message.totalLogs || 0;
                                updateUI();
                                break;
                        }
                    });

                    // Initial update
                    updateUI();
                </script>
            </body>
            </html>`;
    }
}
