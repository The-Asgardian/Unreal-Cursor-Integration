import * as vscode from 'vscode';
import { IPCClient } from './client';
import { ConnectionState, ProjectInfo } from '../state/connectionState';
import { ClientHelloRequest, ClientHelloResponse } from './protocol';
import { StatusBarManager } from '../ui/statusBar';

export class ConnectionManager {
    private client: IPCClient | undefined;
    private outputChannel: vscode.OutputChannel;
    private config: vscode.WorkspaceConfiguration;

    constructor(
        private connectionState: ConnectionState,
        private statusBarManager: StatusBarManager
    ) {
        this.outputChannel = vscode.window.createOutputChannel('Unreal Integration');
        this.config = vscode.workspace.getConfiguration('unreal');
    }

    async connect(): Promise<void> {
        if (this.connectionState.connecting || this.connectionState.connected) {
            return;
        }

        this.connectionState.connecting = true;
        this.outputChannel.appendLine('Connecting to Unreal Engine Editor...');

        try {
            const port = this.config.get<number>('port', 17777);
            const url = `ws://127.0.0.1:${port}`;
            
            this.client = new IPCClient(url);
            
            // Set up event handlers
            this.setupEventHandlers();
            
            // Connect
            await this.client.connect();
            
            // Perform handshake
            await this.performHandshake();
            
            this.connectionState.connected = true;
            this.connectionState.connecting = false;
            this.outputChannel.appendLine('Connected to Unreal Engine Editor');
            
        } catch (error) {
            this.connectionState.connecting = false;
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`Connection failed: ${message}`);
            vscode.window.showErrorMessage(`Failed to connect to Unreal Engine: ${message}`);
        }
    }

    disconnect(): void {
        if (this.client) {
            this.client.disconnect();
            this.client = undefined;
        }
        
        this.connectionState.connected = false;
        this.connectionState.projectInfo = undefined;
        this.outputChannel.appendLine('Disconnected from Unreal Engine Editor');
    }

    async sendRequest(method: string, params: Record<string, any>, cancelToken?: string): Promise<any> {
        if (!this.client || !this.client.isConnected) {
            throw new Error('Not connected to Unreal Engine Editor');
        }

        try {
            const response = await this.client.sendRequest(method, params, cancelToken);
            
            if (response.error) {
                throw new Error(`IPC Error [${response.error.code}]: ${response.error.message}`);
            }
            
            return response.result;
        } catch (error) {
            this.outputChannel.appendLine(`Request failed [${method}]: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }
    }

    onEvent(event: string, handler: (data: any) => void): void {
        if (this.client) {
            this.client.onEvent(event, handler);
        }
    }

    offEvent(event: string, handler: (data: any) => void): void {
        if (this.client) {
            this.client.offEvent(event, handler);
        }
    }

    get isConnected(): boolean {
        return this.client?.isConnected ?? false;
    }

    private async performHandshake(): Promise<void> {
        if (!this.client) {
            throw new Error('Client not initialized');
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspacePath = workspaceFolders?.[0]?.uri.fsPath || '';

        const request: ClientHelloRequest = {
            workspacePath,
            extensionVersion: '0.1.0',
            clientInfo: {
                platform: process.platform,
                vscodeVersion: vscode.version
            }
        };

        const response = await this.client.sendRequest('client.hello', request) as ClientHelloResponse;
        
        const projectInfo: ProjectInfo = {
            engineVersion: response.engineVersion,
            projectName: response.projectName,
            projectPath: response.projectPath,
            supportedPlatforms: response.supportedPlatforms,
            capabilities: response.capabilities
        };

        this.connectionState.projectInfo = projectInfo;
        this.outputChannel.appendLine(`Connected to project: ${projectInfo.projectName} (${projectInfo.engineVersion})`);
    }

    private setupEventHandlers(): void {
        if (!this.client) {
            return;
        }

        // Build events
        this.client.onEvent('build.progress', (data) => {
            this.outputChannel.appendLine(`Build progress: ${data.percent}%`);
        });

        this.client.onEvent('build.outputLine', (data) => {
            this.outputChannel.appendLine(data.line);
        });

        this.client.onEvent('build.finished', (data) => {
            this.connectionState.buildInProgress = false;
            if (data.success) {
                this.outputChannel.appendLine('Build completed successfully');
            } else {
                this.outputChannel.appendLine('Build failed');
            }
        });

        // Live Coding events
        this.client.onEvent('livecoding.statusChanged', (data) => {
            this.connectionState.liveCodingEnabled = data.enabled;
            this.connectionState.liveCodingCompiling = data.compiling;
        });

        // Run events
        this.client.onEvent('run.pieStatus', (data) => {
            this.connectionState.pieRunning = data.running;
        });

        // Profiling events
        this.client.onEvent('profiling.metrics', (data) => {
            // Metrics will be handled by profiling view
        });
    }
}

