import * as vscode from 'vscode';

export interface Capabilities {
    liveCoding: boolean;
    insights: boolean;
    assetEditing: boolean;
    blueprintEditing: boolean;
}

export interface ProjectInfo {
    engineVersion: string;
    projectName: string;
    projectPath: string;
    supportedPlatforms: string[];
    capabilities: Capabilities;
}

export class ConnectionState {
    private _connected: boolean = false;
    private _connecting: boolean = false;
    private _projectInfo: ProjectInfo | undefined;
    private _buildInProgress: boolean = false;
    private _currentBuildId: string | undefined;
    private _liveCodingEnabled: boolean = false;
    private _liveCodingCompiling: boolean = false;
    private _pieRunning: boolean = false;
    private _profilingActive: boolean = false;
    
    private _onStateChangedEmitter = new vscode.EventEmitter<void>();
    public readonly onStateChanged = this._onStateChangedEmitter.event;
    
    get connected(): boolean {
        return this._connected;
    }
    
    set connected(value: boolean) {
        if (this._connected !== value) {
            this._connected = value;
            this._onStateChangedEmitter.fire();
        }
    }
    
    get connecting(): boolean {
        return this._connecting;
    }
    
    set connecting(value: boolean) {
        if (this._connecting !== value) {
            this._connecting = value;
            this._onStateChangedEmitter.fire();
        }
    }
    
    get projectInfo(): ProjectInfo | undefined {
        return this._projectInfo;
    }
    
    set projectInfo(value: ProjectInfo | undefined) {
        this._projectInfo = value;
        this._onStateChangedEmitter.fire();
    }
    
    get buildInProgress(): boolean {
        return this._buildInProgress;
    }
    
    set buildInProgress(value: boolean) {
        if (this._buildInProgress !== value) {
            this._buildInProgress = value;
            this._onStateChangedEmitter.fire();
        }
    }
    
    get currentBuildId(): string | undefined {
        return this._currentBuildId;
    }
    
    set currentBuildId(value: string | undefined) {
        if (this._currentBuildId !== value) {
            this._currentBuildId = value;
            this._onStateChangedEmitter.fire();
        }
    }
    
    get liveCodingEnabled(): boolean {
        return this._liveCodingEnabled;
    }
    
    set liveCodingEnabled(value: boolean) {
        if (this._liveCodingEnabled !== value) {
            this._liveCodingEnabled = value;
            this._onStateChangedEmitter.fire();
        }
    }
    
    get liveCodingCompiling(): boolean {
        return this._liveCodingCompiling;
    }
    
    set liveCodingCompiling(value: boolean) {
        if (this._liveCodingCompiling !== value) {
            this._liveCodingCompiling = value;
            this._onStateChangedEmitter.fire();
        }
    }
    
    get pieRunning(): boolean {
        return this._pieRunning;
    }
    
    set pieRunning(value: boolean) {
        if (this._pieRunning !== value) {
            this._pieRunning = value;
            this._onStateChangedEmitter.fire();
        }
    }
    
    get profilingActive(): boolean {
        return this._profilingActive;
    }
    
    set profilingActive(value: boolean) {
        if (this._profilingActive !== value) {
            this._profilingActive = value;
            this._onStateChangedEmitter.fire();
        }
    }
    
    get capabilities(): Capabilities | undefined {
        return this._projectInfo?.capabilities;
    }
}

