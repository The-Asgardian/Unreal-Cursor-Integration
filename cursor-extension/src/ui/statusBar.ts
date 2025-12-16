import * as vscode from 'vscode';
import { ConnectionState } from '../state/connectionState';

export class StatusBarManager {
    private connectionItem: vscode.StatusBarItem;
    private liveCodingItem: vscode.StatusBarItem;
    private pieItem: vscode.StatusBarItem;
    private buildItem: vscode.StatusBarItem;
    private cacheItem: vscode.StatusBarItem;

    constructor(private connectionState: ConnectionState) {
        this.connectionItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.connectionItem.command = 'unreal.connect';
        this.connectionItem.tooltip = 'Click to connect to Unreal Engine';

        this.liveCodingItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        this.liveCodingItem.command = 'unreal.liveCoding.toggle';
        this.liveCodingItem.tooltip = 'Live Coding Status';

        this.pieItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
        this.pieItem.command = 'unreal.run.stopPIE';
        this.pieItem.tooltip = 'PIE Status';

        this.buildItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
        this.buildItem.tooltip = 'Build Status';

        this.cacheItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
        this.cacheItem.tooltip = 'Reflection Cache Status';

        connectionState.onStateChanged(() => {
            this.update();
        });

        this.update();
    }

    update(): void {
        // Connection status
        if (this.connectionState.connected) {
            this.connectionItem.text = '$(plug) UE: Connected';
            this.connectionItem.command = 'unreal.disconnect';
            this.connectionItem.tooltip = 'Click to disconnect from Unreal Engine';
            this.connectionItem.backgroundColor = undefined;
        } else if (this.connectionState.connecting) {
            this.connectionItem.text = '$(sync~spin) UE: Connecting...';
            this.connectionItem.command = undefined;
            this.connectionItem.backgroundColor = undefined;
        } else {
            this.connectionItem.text = '$(plug) UE: Disconnected';
            this.connectionItem.command = 'unreal.connect';
            this.connectionItem.tooltip = 'Click to connect to Unreal Engine';
            this.connectionItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
        this.connectionItem.show();

        // Live Coding status
        if (this.connectionState.connected && this.connectionState.capabilities?.liveCoding) {
            if (this.connectionState.liveCodingCompiling) {
                this.liveCodingItem.text = '$(sync~spin) Live Coding: Compiling';
                this.liveCodingItem.command = undefined;
            } else if (this.connectionState.liveCodingEnabled) {
                this.liveCodingItem.text = '$(sync) Live Coding: Enabled';
                this.liveCodingItem.command = 'unreal.liveCoding.toggle';
            } else {
                this.liveCodingItem.text = '$(sync) Live Coding: Disabled';
                this.liveCodingItem.command = 'unreal.liveCoding.toggle';
            }
            this.liveCodingItem.show();
        } else {
            this.liveCodingItem.hide();
        }

        // PIE status
        if (this.connectionState.connected) {
            if (this.connectionState.pieRunning) {
                this.pieItem.text = '$(debug-pause) PIE: Running';
                this.pieItem.command = 'unreal.run.stopPIE';
                this.pieItem.show();
            } else {
                this.pieItem.text = '$(play) PIE: Stopped';
                this.pieItem.command = 'unreal.run.playPIE';
                this.pieItem.show();
            }
        } else {
            this.pieItem.hide();
        }

        // Build status
        if (this.connectionState.buildInProgress) {
            this.buildItem.text = '$(sync~spin) Building...';
            this.buildItem.command = 'unreal.build.cancel';
            this.buildItem.tooltip = 'Click to cancel build';
            this.buildItem.show();
        } else {
            this.buildItem.hide();
        }

        // Cache status
        if (this.connectionState.connected) {
            console.log('[StatusBar] Cache state:', {
                building: this.connectionState.cacheBuilding,
                ready: this.connectionState.cacheReady,
                progress: this.connectionState.cacheProgress,
                message: this.connectionState.cacheProgressMessage
            });
            
            if (this.connectionState.cacheBuilding) {
                const progress = this.connectionState.cacheProgress;
                const message = this.connectionState.cacheProgressMessage;
                if (progress > 0) {
                    this.cacheItem.text = `$(sync~spin) Cache: ${progress}%${message ? ` - ${message}` : ''}`;
                } else {
                    this.cacheItem.text = `$(sync~spin) Cache: Building${message ? ` - ${message}` : ''}`;
                }
                this.cacheItem.tooltip = 'Reflection cache is being built';
                this.cacheItem.show();
                console.log('[StatusBar] Showing cache building status');
            } else if (this.connectionState.cacheReady) {
                this.cacheItem.text = '$(check) Cache: Ready';
                this.cacheItem.tooltip = 'Reflection cache is ready';
                this.cacheItem.show();
                console.log('[StatusBar] Showing cache ready status');
            } else {
                // Show "Not Ready" state so user knows cache status
                this.cacheItem.text = '$(clock) Cache: Not Ready';
                this.cacheItem.tooltip = 'Reflection cache is not ready yet';
                this.cacheItem.show();
                console.log('[StatusBar] Showing cache not ready status');
            }
        } else {
            this.cacheItem.hide();
            console.log('[StatusBar] Hiding cache item (not connected)');
        }
    }

    dispose(): void {
        this.connectionItem.dispose();
        this.liveCodingItem.dispose();
        this.pieItem.dispose();
        this.buildItem.dispose();
        this.cacheItem.dispose();
    }
}

