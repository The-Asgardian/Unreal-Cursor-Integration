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
            // Root level - show main sections
            return Promise.resolve([
                this.createConnectionItem(),
                this.createBuildItem(),
                this.createLiveCodingItem(),
                this.createRunItem(),
                this.createLogsItem(),
                this.createProfilingItem()
            ]);
        }

        // Child items based on parent
        if (element.label === 'Connection') {
            return Promise.resolve(this.getConnectionChildren());
        } else if (element.label === 'Build') {
            return Promise.resolve(this.getBuildChildren());
        } else if (element.label === 'Live Coding') {
            return Promise.resolve(this.getLiveCodingChildren());
        } else if (element.label === 'Run') {
            return Promise.resolve(this.getRunChildren());
        } else if (element.label === 'Logs') {
            return Promise.resolve(this.getLogsChildren());
        } else if (element.label === 'Performance') {
            return Promise.resolve(this.getProfilingChildren());
        }

        return Promise.resolve([]);
    }

    private createConnectionItem(): UnrealTreeItem {
        const status = this.connectionState.connected ? 'Connected' : 
                      this.connectionState.connecting ? 'Connecting...' : 'Disconnected';
        const icon = this.connectionState.connected ? new vscode.ThemeIcon('plug') : 
                    new vscode.ThemeIcon('plug', new vscode.ThemeColor('errorForeground'));
        
        return new UnrealTreeItem(
            `Connection: ${status}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            icon
        );
    }

    private createBuildItem(): UnrealTreeItem {
        const status = this.connectionState.buildInProgress ? 'Building...' : 'Ready';
        const icon = this.connectionState.buildInProgress ? 
                    new vscode.ThemeIcon('sync~spin') : 
                    new vscode.ThemeIcon('tools');
        
        return new UnrealTreeItem(
            `Build: ${status}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            icon
        );
    }

    private createLiveCodingItem(): UnrealTreeItem {
        const enabled = this.connectionState.liveCodingEnabled;
        const compiling = this.connectionState.liveCodingCompiling;
        const status = compiling ? 'Compiling...' : enabled ? 'Enabled' : 'Disabled';
        const icon = compiling ? 
                    new vscode.ThemeIcon('sync~spin') : 
                    new vscode.ThemeIcon('sync');
        
        const item = new UnrealTreeItem(
            `Live Coding: ${status}`,
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
        const status = this.connectionState.pieRunning ? 'Running' : 'Stopped';
        const icon = this.connectionState.pieRunning ? 
                    new vscode.ThemeIcon('debug-pause') : 
                    new vscode.ThemeIcon('play');
        
        return new UnrealTreeItem(
            `Run: ${status}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            icon
        );
    }

    private createLogsItem(): UnrealTreeItem {
        return new UnrealTreeItem(
            'Logs',
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            new vscode.ThemeIcon('output')
        );
    }

    private createProfilingItem(): UnrealTreeItem {
        const status = this.connectionState.profilingActive ? 'Active' : 'Inactive';
        const icon = this.connectionState.profilingActive ? 
                    new vscode.ThemeIcon('graph') : 
                    new vscode.ThemeIcon('graph', new vscode.ThemeColor('disabledForeground'));
        
        return new UnrealTreeItem(
            `Performance: ${status}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            undefined,
            icon
        );
    }

    private getConnectionChildren(): UnrealTreeItem[] {
        const items: UnrealTreeItem[] = [];
        
        if (this.connectionState.projectInfo) {
            items.push(new UnrealTreeItem(
                `Project: ${this.connectionState.projectInfo.projectName}`,
                vscode.TreeItemCollapsibleState.None
            ));
            items.push(new UnrealTreeItem(
                `Engine: ${this.connectionState.projectInfo.engineVersion}`,
                vscode.TreeItemCollapsibleState.None
            ));
        }
        
        if (this.connectionState.connected) {
            items.push(new UnrealTreeItem(
                'Disconnect',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'unreal.disconnect',
                    title: 'Disconnect'
                },
                new vscode.ThemeIcon('plug')
            ));
        } else {
            items.push(new UnrealTreeItem(
                'Connect',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'unreal.connect',
                    title: 'Connect'
                },
                new vscode.ThemeIcon('plug')
            ));
        }
        
        items.push(new UnrealTreeItem(
            'Settings',
            vscode.TreeItemCollapsibleState.None,
            {
                command: 'unreal.settings.open',
                title: 'Settings'
            },
            new vscode.ThemeIcon('settings-gear')
        ));
        
        return items;
    }

    private getBuildChildren(): UnrealTreeItem[] {
        return [
            new UnrealTreeItem(
                'Build Editor',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'unreal.build.editor',
                    title: 'Build Editor'
                },
                new vscode.ThemeIcon('tools')
            ),
            new UnrealTreeItem(
                'Build Game',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'unreal.build.game',
                    title: 'Build Game'
                },
                new vscode.ThemeIcon('tools')
            ),
            new UnrealTreeItem(
                'Clean',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'unreal.build.clean',
                    title: 'Clean'
                },
                new vscode.ThemeIcon('trash')
            ),
            new UnrealTreeItem(
                'Generate Project Files',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'unreal.project.generateFiles',
                    title: 'Generate Project Files'
                },
                new vscode.ThemeIcon('file-code')
            ),
            new UnrealTreeItem(
                'Generate compile_commands.json',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'unreal.intellisense.generateCompileCommands',
                    title: 'Generate compile_commands.json'
                },
                new vscode.ThemeIcon('code')
            )
        ];
    }

    private getLiveCodingChildren(): UnrealTreeItem[] {
        const items: UnrealTreeItem[] = [];
        
        if (!this.connectionState.capabilities?.liveCoding) {
            items.push(new UnrealTreeItem(
                'Live Coding Unsupported',
                vscode.TreeItemCollapsibleState.None
            ));
            return items;
        }
        
        items.push(new UnrealTreeItem(
            'Compile',
            vscode.TreeItemCollapsibleState.None,
            {
                command: 'unreal.liveCoding.compile',
                title: 'Compile'
            },
            new vscode.ThemeIcon('sync')
        ));
        
        items.push(new UnrealTreeItem(
            this.connectionState.liveCodingEnabled ? 'Disable' : 'Enable',
            vscode.TreeItemCollapsibleState.None,
            {
                command: 'unreal.liveCoding.toggle',
                title: 'Toggle Live Coding'
            },
            new vscode.ThemeIcon('sync')
        ));
        
        items.push(new UnrealTreeItem(
            'Restart',
            vscode.TreeItemCollapsibleState.None,
            {
                command: 'unreal.liveCoding.restart',
                title: 'Restart Live Coding'
            },
            new vscode.ThemeIcon('refresh')
        ));
        
        return items;
    }

    private getRunChildren(): UnrealTreeItem[] {
        return [
            new UnrealTreeItem(
                'Play In Editor',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'unreal.run.playPIE',
                    title: 'Play In Editor'
                },
                new vscode.ThemeIcon('play')
            ),
            new UnrealTreeItem(
                'Stop PIE',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'unreal.run.stopPIE',
                    title: 'Stop PIE'
                },
                new vscode.ThemeIcon('stop')
            ),
            new UnrealTreeItem(
                'Run Standalone',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'unreal.run.standalone',
                    title: 'Run Standalone'
                },
                new vscode.ThemeIcon('terminal')
            )
        ];
    }

    private getLogsChildren(): UnrealTreeItem[] {
        return [
            new UnrealTreeItem(
                'Open Logs View',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'unreal.logs.open',
                    title: 'Open Logs View'
                },
                new vscode.ThemeIcon('output')
            ),
            new UnrealTreeItem(
                'Clear Logs',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'unreal.logs.clear',
                    title: 'Clear Logs'
                },
                new vscode.ThemeIcon('clear-all')
            ),
            new UnrealTreeItem(
                'Set Filter',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'unreal.logs.setFilter',
                    title: 'Set Filter'
                },
                new vscode.ThemeIcon('filter')
            )
        ];
    }

    private getProfilingChildren(): UnrealTreeItem[] {
        return [
            new UnrealTreeItem(
                this.connectionState.profilingActive ? 'Stop Profiling' : 'Start Profiling',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: this.connectionState.profilingActive ? 'unreal.profiling.stop' : 'unreal.profiling.start',
                    title: this.connectionState.profilingActive ? 'Stop Profiling' : 'Start Profiling'
                },
                new vscode.ThemeIcon('graph')
            ),
            new UnrealTreeItem(
                'Open Dashboard',
                vscode.TreeItemCollapsibleState.None,
                {
                    command: 'unreal.profiling.openDashboard',
                    title: 'Open Dashboard'
                },
                new vscode.ThemeIcon('dashboard')
            )
        ];
    }
}

