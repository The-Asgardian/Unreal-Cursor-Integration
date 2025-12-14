import * as vscode from 'vscode';
import { UnrealTreeDataProvider } from './ui/treeView';
import { StatusBarManager } from './ui/statusBar';
import { ConnectionManager } from './ipc/connectionManager';
import { ConnectionState } from './state/connectionState';
import * as buildCommands from './commands/build';
import * as liveCodingCommands from './commands/liveCoding';
import * as runCommands from './commands/run';
import * as logsCommands from './commands/logs';
import * as profilingCommands from './commands/profiling';
import * as assetsCommands from './commands/assets';
import * as intellisenseCommands from './commands/intellisense';

let connectionManager: ConnectionManager | undefined;
let treeDataProvider: UnrealTreeDataProvider | undefined;
let statusBarManager: StatusBarManager | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Unreal Engine Cursor Integration extension is now active');

    // Initialize state
    const connectionState = new ConnectionState();
    
    // Initialize UI components
    treeDataProvider = new UnrealTreeDataProvider(connectionState);
    statusBarManager = new StatusBarManager(connectionState);
    
    // Initialize connection manager
    connectionManager = new ConnectionManager(connectionState, statusBarManager);
    
    // Register tree view
    const treeView = vscode.window.createTreeView('unrealTreeView', {
        treeDataProvider: treeDataProvider,
        showCollapseAll: true
    });
    
    context.subscriptions.push(treeView);
    
    // Register commands
    registerCommands(context, connectionManager, connectionState);
    
    // Auto-connect if enabled
    const config = vscode.workspace.getConfiguration('unreal');
    if (config.get<boolean>('autoConnect', false)) {
        connectionManager.connect();
    }
    
    // Update UI when state changes
    connectionState.onStateChanged(() => {
        treeDataProvider?.refresh();
        statusBarManager?.update();
    });
}

function registerCommands(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionState: ConnectionState
) {
    // Connection commands
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.connect', () => {
            connectionManager.connect();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.disconnect', () => {
            connectionManager.disconnect();
        })
    );
    
    // Build commands
    buildCommands.register(context, connectionManager, connectionState);
    
    // Live Coding commands
    liveCodingCommands.register(context, connectionManager, connectionState);
    
    // Run commands
    runCommands.register(context, connectionManager, connectionState);
    
    // Logs commands
    logsCommands.register(context, connectionManager, connectionState);
    
    // Profiling commands
    profilingCommands.register(context, connectionManager, connectionState);
    
    // Assets commands
    assetsCommands.register(context, connectionManager, connectionState);
    
    // IntelliSense commands
    intellisenseCommands.register(context, connectionManager, connectionState);
    
    // Settings command
    context.subscriptions.push(
        vscode.commands.registerCommand('unreal.settings.open', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'unreal');
        })
    );
}

export function deactivate() {
    connectionManager?.disconnect();
    statusBarManager?.dispose();
}

