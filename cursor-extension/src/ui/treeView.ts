import * as vscode from 'vscode';
import { ConnectionState } from '../state/connectionState';

export class UnrealTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        public readonly iconPath?: vscode.ThemeIcon | string
    ) {
        super(label, collapsibleState);
        this.tooltip = label;
        if (command) {
            this.command = command;
        }
        if (iconPath) {
            this.iconPath = iconPath;
        }
    }
}

export class UnrealTreeDataProvider implements vscode.TreeDataProvider<UnrealTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<UnrealTreeItem | undefined | null | void> = new vscode.EventEmitter<UnrealTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<UnrealTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private connectionState: ConnectionState) {
        connectionState.onStateChanged(() => {
            this.refresh();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: UnrealTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: UnrealTreeItem): Thenable<UnrealTreeItem[]> {
        if (!element) {
            // Root level - status indicators with action buttons
            return Promise.resolve([
                this.createConnectionItem(),
                this.createPlayEditorItem(),
                this.createBuildItem(),
                this.createLiveCodingItem(),
                this.createRunItem()
            ]);
        }

        // Return action buttons for each status item
        if (element.label === 'Connected' || element.label === 'Disconnected' || element.label === 'Connecting...') {
            return Promise.resolve([
                this.createActionItem('Connect', 'unreal.connect', 'plug', !this.connectionState.connected && !this.connectionState.connecting),
                this.createActionItem('Disconnect', 'unreal.disconnect', 'plug', this.connectionState.connected)
            ]);
        }

        if (element.label === 'Play Editor' || element.label.includes('Play Editor')) {
            return Promise.resolve([
                this.createActionItem('Launch Unreal Editor', 'unreal.editor.launch', 'rocket', true)
            ]);
        }

        if (element.label === 'Building...' || element.label === 'Ready' || element.label.includes('Build')) {
            return Promise.resolve([
                this.createActionItem('Build Editor', 'unreal.build.editor', 'tools', this.connectionState.connected && !this.connectionState.buildInProgress),
                this.createActionItem('Rebuild', 'unreal.build.rebuild', 'sync', this.connectionState.connected && !this.connectionState.buildInProgress),
                this.createActionItem('Clean', 'unreal.build.clean', 'trash', this.connectionState.connected && !this.connectionState.buildInProgress),
                this.createActionItem('Cancel Build', 'unreal.build.cancel', 'stop-circle', this.connectionState.connected && this.connectionState.buildInProgress)
            ]);
        }

        if (element.label === 'Compiling...' || element.label === 'Enabled' || element.label === 'Disabled' || element.label.includes('Live Coding')) {
            const canCompile = this.connectionState.connected && 
                              this.connectionState.capabilities?.liveCoding && 
                              !this.connectionState.liveCodingCompiling;
            return Promise.resolve([
                this.createActionItem('Compile (Live Coding)', 'unreal.liveCoding.compile', 'sync', canCompile)
            ]);
        }

        if (element.label === 'Running' || element.label === 'Stopped' || element.label.includes('Run')) {
            return Promise.resolve([
                this.createActionItem('Play In Editor', 'unreal.run.playPIE', 'play', this.connectionState.connected && !this.connectionState.pieRunning),
                this.createActionItem('Stop PIE', 'unreal.run.stopPIE', 'stop', this.connectionState.connected && this.connectionState.pieRunning),
                this.createActionItem('Start Debugging', 'unreal.debug.start', 'debug-start', this.connectionState.connected && !this.connectionState.pieRunning)
            ]);
        }

        return Promise.resolve([]);
    }

    private createConnectionItem(): UnrealTreeItem {
        const status = this.connectionState.connected ? 'Connected' : 
                      this.connectionState.connecting ? 'Connecting...' : 'Disconnected';
        const icon = this.connectionState.connected ? new vscode.ThemeIcon('plug') : 
                    new vscode.ThemeIcon('plug', new vscode.ThemeColor('errorForeground'));
        
        return new UnrealTreeItem(
            status,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            icon
        );
    }

    private createPlayEditorItem(): UnrealTreeItem {
        return new UnrealTreeItem(
            'Play Editor',
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            new vscode.ThemeIcon('rocket')
        );
    }

    private createBuildItem(): UnrealTreeItem {
        const status = this.connectionState.buildInProgress ? 'Building...' : 'Build Tools';
        const icon = this.connectionState.buildInProgress ? 
                    new vscode.ThemeIcon('sync~spin') : 
                    new vscode.ThemeIcon('tools');
        
        return new UnrealTreeItem(
            status,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            icon
        );
    }

    private createLiveCodingItem(): UnrealTreeItem {
        const enabled = this.connectionState.liveCodingEnabled;
        const compiling = this.connectionState.liveCodingCompiling;
        const status = compiling ? 'Compiling...' : enabled ? 'Live Coding' : 'Live Coding';
        const icon = compiling ? 
                    new vscode.ThemeIcon('sync~spin') : 
                    new vscode.ThemeIcon('sync');
        
        const item = new UnrealTreeItem(
            status,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            icon
        );
        
        // Disable if capability not available
        if (this.connectionState.capabilities && !this.connectionState.capabilities.liveCoding) {
            item.description = 'Unsupported';
        }
        
        return item;
    }

    private createRunItem(): UnrealTreeItem {
        const status = this.connectionState.pieRunning ? 'Running' : 'Run';
        const icon = this.connectionState.pieRunning ? 
                    new vscode.ThemeIcon('debug-pause') : 
                    new vscode.ThemeIcon('play');
        
        return new UnrealTreeItem(
            status,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            icon
        );
    }

    private createActionItem(label: string, command: string, icon: string, enabled: boolean = true): UnrealTreeItem {
        const item = new UnrealTreeItem(
            label,
            vscode.TreeItemCollapsibleState.None,
            enabled ? {
                command: command,
                title: label
            } : undefined,
            enabled ? new vscode.ThemeIcon(icon) : new vscode.ThemeIcon(icon, new vscode.ThemeColor('disabledForeground'))
        );
        
        if (!enabled) {
            item.description = '(requires connection)';
        }
        
        return item;
    }

}

