import * as vscode from 'vscode';
import { IPCClient } from './client';
import { ConnectionState, ProjectInfo } from '../state/connectionState';
import { ClientHelloRequest, ClientHelloResponse } from './protocol';
import { StatusBarManager } from '../ui/statusBar';

export class ConnectionManager {
    private client: IPCClient | undefined;
    public readonly outputChannel: vscode.OutputChannel; // Made public for logging access
    private config: vscode.WorkspaceConfiguration;

    private clientOutputChannel: vscode.OutputChannel;
    private autoConnectRetryTimer: NodeJS.Timeout | undefined;
    private autoConnectRetryCount: number = 0;
    private readonly maxAutoConnectRetries: number = 30; // Try for 30 seconds (30 retries * 1 second)
    private readonly autoConnectRetryDelay: number = 1000; // 1 second between retries

    constructor(
        private connectionState: ConnectionState,
        private statusBarManager: StatusBarManager
    ) {
        this.outputChannel = vscode.window.createOutputChannel('Unreal Integration');
        this.clientOutputChannel = vscode.window.createOutputChannel('Unreal IPC Debug');
        this.config = vscode.workspace.getConfiguration('unreal');
    }

    async connect(): Promise<void> {
        if (this.connectionState.connecting || this.connectionState.connected) {
            // Don't log this every time to reduce spam
            return;
        }

        this.connectionState.connecting = true;
        this.outputChannel.appendLine('[Connection] Starting connection attempt...');
        this.outputChannel.show(true); // Ensure output channel is visible

        try {
            const port = this.config.get<number>('port', 17777);
            const url = `ws://127.0.0.1:${port}`;
            
            this.outputChannel.appendLine(`[Connection] Connecting to WebSocket: ${url}`);
            this.client = new IPCClient(url);
            
            // Connect first
            this.outputChannel.appendLine('[Connection] Attempting WebSocket connection...');
            await this.client.connect();
            this.outputChannel.appendLine('[Connection] ✓ WebSocket connection established');
            
            // Set up event handlers after connection
            this.setupEventHandlers();
            
            // Small delay to ensure message handlers are ready
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Perform handshake
            this.outputChannel.appendLine('[Connection] Sending client.hello handshake...');
            await this.performHandshake();
            
            this.connectionState.connected = true;
            this.connectionState.connecting = false;
            this.outputChannel.appendLine('[Connection] ✓ Successfully connected to Unreal Engine Editor');
            
        } catch (error) {
            this.connectionState.connecting = false;
            const message = error instanceof Error ? error.message : 'Unknown error';
            
            // Normalize path separators in error messages to prevent backslash issues
            const normalizedMessage = message.replace(/\\/g, '/');
            this.outputChannel.appendLine(`[Connection] ✗ Connection failed: ${normalizedMessage}`);
            
            // Only show error message if it's not a connection refused (editor not running)
            if (!normalizedMessage.includes('ECONNREFUSED') && !normalizedMessage.includes('Connection timeout')) {
                vscode.window.showErrorMessage(`Failed to connect to Unreal Engine: ${normalizedMessage}`);
            }
            throw error; // Re-throw so retry logic can catch it
        }
    }

    disconnect(): void {
        // Stop auto-connect retries when disconnecting
        this.stopAutoConnectRetry();

        if (this.client) {
            this.client.disconnect();
            this.client = undefined;
        }
        
        this.connectionState.connected = false;
        this.connectionState.projectInfo = undefined;
        this.outputChannel.appendLine('Disconnected from Unreal Engine Editor');
    }

    async sendRequest(method: string, params: Record<string, any>, cancelToken?: string, timeout?: number): Promise<any> {
        if (!this.client || !this.client.isConnected) {
            throw new Error('Not connected to Unreal Engine Editor');
        }

        try {
            const response = await this.client.sendRequest(method, params, cancelToken, timeout);
            
            if (response.error) {
                throw new Error(`IPC Error [${response.error.code}]: ${response.error.message}`);
            }
            
            return response.result;
        } catch (error) {
            this.outputChannel.appendLine(`Request failed [${method}]: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }
    }

    onEvent(event: string, handler: (event: string, data: any) => void): void {
        if (this.client) {
            this.client.onEvent(event, handler);
        }
    }

    offEvent(event: string, handler: (event: string, data: any) => void): void {
        if (this.client) {
            this.client.offEvent(event, handler);
        }
    }

    get isConnected(): boolean {
        return this.client?.isConnected ?? false;
    }

    /**
     * Attempts to auto-connect with retry logic
     * This is useful when the editor might not be running yet
     * Only attempts connection if Unreal Editor process is detected
     */
    async autoConnectWithRetry(silent: boolean = false): Promise<void> {
        // Import process detector dynamically
        const { isUnrealEditorRunning } = require('../utils/processDetector');
        
        this.outputChannel.appendLine('[Auto-Connect] Starting auto-connect with retry...');
        this.outputChannel.show(true); // Ensure output channel is visible
        
        // Stop any existing retry attempts
        this.stopAutoConnectRetry();

        // If already connected, return
        if (this.connectionState.connected) {
            this.outputChannel.appendLine('[Auto-Connect] Already connected, skipping...');
            return;
        }

        // Check if Unreal Editor process is running first
        this.outputChannel.appendLine('[Auto-Connect] Checking if Unreal Editor is running...');
        const isRunning = await isUnrealEditorRunning(this.outputChannel);
        
        if (!isRunning) {
            this.outputChannel.appendLine('[Auto-Connect] Unreal Editor process not detected. Will monitor for process start...');
            // Start retry loop that checks for process before connecting
            this.autoConnectRetryCount = 0;
            this.startAutoConnectRetry(silent);
            return;
        }

        // Process is running, try immediate connection
        this.outputChannel.appendLine('[Auto-Connect] Editor process detected, attempting connection...');
        try {
            await this.connect();
            if (this.connectionState.connected) {
                this.outputChannel.appendLine('[Auto-Connect] ✓ Successfully connected on first attempt');
                return;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`[Auto-Connect] Immediate connection failed: ${message}`);
            this.outputChannel.appendLine('[Auto-Connect] Will retry in background...');
        }

        // If connection failed and we should retry, start retry loop
        if (!this.connectionState.connected) {
            this.outputChannel.appendLine(`[Auto-Connect] Starting retry loop (max ${this.maxAutoConnectRetries} attempts, ${this.autoConnectRetryDelay}ms delay)`);
            this.autoConnectRetryCount = 0;
            this.startAutoConnectRetry(silent);
        }
    }

    /**
     * Starts the auto-connect retry loop
     */
    private startAutoConnectRetry(silent: boolean = false): void {
        this.stopAutoConnectRetry();

        // Import process detector dynamically to avoid circular dependencies
        const { isUnrealEditorRunning } = require('../utils/processDetector');

        this.outputChannel.appendLine(`[Auto-Connect] Retry timer started (interval: ${this.autoConnectRetryDelay}ms)`);

        this.autoConnectRetryTimer = setInterval(async () => {
            if (this.connectionState.connected || this.connectionState.connecting) {
                this.outputChannel.appendLine('[Auto-Connect] Connection state changed, stopping retry loop');
                this.stopAutoConnectRetry();
                return;
            }

            this.autoConnectRetryCount++;
            
            // Only log every 5th attempt to reduce log spam
            if (this.autoConnectRetryCount % 5 === 0 || this.autoConnectRetryCount === 1) {
                this.outputChannel.appendLine(`[Auto-Connect] Retry attempt ${this.autoConnectRetryCount}/${this.maxAutoConnectRetries}`);
            }
            
            if (this.autoConnectRetryCount > this.maxAutoConnectRetries) {
                this.stopAutoConnectRetry();
                this.outputChannel.appendLine('[Auto-Connect] ✗ Maximum retries reached. Editor not detected.');
                this.outputChannel.appendLine('[Auto-Connect] Please start the Unreal Engine Editor to connect.');
                if (!silent) {
                    vscode.window.showInformationMessage('Unreal Engine Editor not detected. Start the editor to connect.');
                }
                return;
            }

            // Check if process is running before attempting connection
            const isRunning = await isUnrealEditorRunning(this.outputChannel);
            if (!isRunning) {
                // Only log every 10th attempt when process not running
                if (this.autoConnectRetryCount % 10 === 0) {
                    this.outputChannel.appendLine(`[Auto-Connect] Editor process not detected (attempt ${this.autoConnectRetryCount}/${this.maxAutoConnectRetries})`);
                }
                return; // Don't attempt connection if process isn't running
            }

            try {
                // Only log connection attempts, not every retry
                if (this.autoConnectRetryCount === 1 || this.autoConnectRetryCount % 5 === 0) {
                    this.outputChannel.appendLine(`[Auto-Connect] Attempting connection (attempt ${this.autoConnectRetryCount})...`);
                }
                await this.connect();
                if (this.connectionState.connected) {
                    this.outputChannel.appendLine(`[Auto-Connect] ✓ Successfully connected on attempt ${this.autoConnectRetryCount}`);
                    this.stopAutoConnectRetry();
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                // Only log errors on first attempt or every 5th attempt
                if (this.autoConnectRetryCount === 1 || this.autoConnectRetryCount % 5 === 0) {
                    this.outputChannel.appendLine(`[Auto-Connect] Connection attempt ${this.autoConnectRetryCount} failed: ${message}`);
                }
            }
        }, this.autoConnectRetryDelay);
    }

    /**
     * Stops the auto-connect retry loop
     */
    stopAutoConnectRetry(): void {
        if (this.autoConnectRetryTimer) {
            clearInterval(this.autoConnectRetryTimer);
            this.autoConnectRetryTimer = undefined;
        }
        this.autoConnectRetryCount = 0;
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

        const responseMessage = await this.client.sendRequest('client.hello', request);
        const response = responseMessage.result as ClientHelloResponse;
        
        const projectInfo: ProjectInfo = {
            engineVersion: response.engineVersion,
            projectName: response.projectName,
            projectPath: response.projectPath,
            supportedPlatforms: response.supportedPlatforms,
            capabilities: response.capabilities
        };

        this.connectionState.projectInfo = projectInfo;
        this.outputChannel.appendLine(`Connected to project: ${projectInfo.projectName} (${projectInfo.engineVersion})`);
        
        // Query cache status on connection to get current state
        this.queryCacheStatus();
    }
    
    private async queryCacheStatus(): Promise<void> {
        try {
            this.outputChannel.appendLine('[DEBUG] Querying cache status after connection...');
            console.log('[ConnectionManager] Querying cache status...');
            const cacheStatus = await this.sendRequest('reflection.cacheStatus', {}, undefined, 5000);
            this.outputChannel.appendLine(`[DEBUG] Cache status response: ${JSON.stringify(cacheStatus)}`);
            console.log('[ConnectionManager] Cache status received:', cacheStatus);
            
            if (cacheStatus) {
                if (cacheStatus.ready) {
                    this.connectionState.cacheReady = true;
                    this.connectionState.cacheBuilding = false;
                    this.connectionState.cacheProgress = 100;
                    this.outputChannel.appendLine('[Reflection Cache] Cache is ready');
                    console.log('[ConnectionManager] Cache is ready');
                } else {
                    this.connectionState.cacheReady = false;
                    // Don't set cacheBuilding to false here - it might already be building
                    // The building event will set it to true when cache starts building
                    this.outputChannel.appendLine('[Reflection Cache] Cache is not ready yet - waiting for build events...');
                    console.log('[ConnectionManager] Cache is not ready yet');
                    
                    // If cache is not ready and not building, it might need to be triggered
                    // But we'll wait for events from the plugin rather than triggering manually
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.outputChannel.appendLine(`[DEBUG] Failed to query cache status: ${errorMessage}`);
            console.error('[ConnectionManager] Failed to query cache status:', error);
            // Don't throw - cache status query is optional
        }
    }

    private setupEventHandlers(): void {
        if (!this.client) {
            return;
        }

        // Build events
        this.client.onEvent('build.progress', (_event, data: { percent: number }) => {
            this.outputChannel.appendLine(`Build progress: ${data.percent}%`);
        });

        this.client.onEvent('build.outputLine', (_event, data: { line: string }) => {
            this.outputChannel.appendLine(data.line);
        });

        this.client.onEvent('build.finished', (_event, data: { success: boolean }) => {
            this.connectionState.buildInProgress = false;
            if (data.success) {
                this.outputChannel.appendLine('Build completed successfully');
            } else {
                this.outputChannel.appendLine('Build failed');
            }
        });

        // Live Coding events
        this.client.onEvent('livecoding.statusChanged', (_event, data: { enabled: boolean; compiling: boolean }) => {
            this.connectionState.liveCodingEnabled = data.enabled;
            this.connectionState.liveCodingCompiling = data.compiling;
        });

        // Run events
        this.client.onEvent('run.pieStatus', (_event, data: { running: boolean }) => {
            this.connectionState.pieRunning = data.running;
        });

        // Profiling events
        this.client.onEvent('profiling.metrics', (data) => {
            // Metrics will be handled by profiling view
        });

        // Cache events
        this.client.onEvent('reflection.cacheBuilding', (_event, data: { message?: string }) => {
            console.log('[ConnectionManager] Received reflection.cacheBuilding event:', data);
            this.outputChannel.appendLine(`[DEBUG] [Reflection Cache] Received cacheBuilding event: ${JSON.stringify(data)}`);
            this.connectionState.cacheBuilding = true;
            this.connectionState.cacheReady = false;
            const message = data.message || 'Starting cache build...';
            this.connectionState.cacheProgressMessage = message;
            this.outputChannel.appendLine(`[Reflection Cache] Building: ${message}`);
        });

        this.client.onEvent('reflection.cacheProgress', (_event, data: { percent: number; message?: string }) => {
            console.log('[ConnectionManager] Received reflection.cacheProgress event:', data);
            this.outputChannel.appendLine(`[DEBUG] [Reflection Cache] Received cacheProgress event: ${JSON.stringify(data)}`);
            this.connectionState.cacheBuilding = true;
            this.connectionState.cacheProgress = data.percent;
            if (data.message) {
                this.connectionState.cacheProgressMessage = data.message;
            }
            this.outputChannel.appendLine(`[Reflection Cache] Progress: ${data.percent}%${data.message ? ` - ${data.message}` : ''}`);
        });

        this.client.onEvent('reflection.cacheReady', (_event, data: { classCount?: number; symbolCount?: number }) => {
            console.log('[ConnectionManager] Received reflection.cacheReady event:', data);
            this.outputChannel.appendLine(`[DEBUG] [Reflection Cache] Received cacheReady event: ${JSON.stringify(data)}`);
            this.connectionState.cacheBuilding = false;
            this.connectionState.cacheReady = true;
            this.connectionState.cacheProgress = 100;
            this.connectionState.cacheProgressMessage = '';
            
            const classInfo = data.classCount !== undefined ? `${data.classCount} classes` : '';
            const symbolInfo = data.symbolCount !== undefined ? `${data.symbolCount} symbols` : '';
            const info = [classInfo, symbolInfo].filter(s => s).join(', ');
            
            this.outputChannel.appendLine(`[Reflection Cache] ✓ Ready${info ? ` (${info})` : ''}`);
        });
    }
}

