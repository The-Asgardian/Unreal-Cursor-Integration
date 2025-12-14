# Unreal Engine Cursor Integration

Production-ready, modular system providing deep Unreal Engine Editor integration inside Cursor via a VS Code extension (TypeScript) and an Unreal Engine Editor plugin (C++).

## Overview

This integration enables full "IDE control plane" inside Cursor:
- **Connection & Settings**: Connect to Unreal Engine Editor via WebSocket IPC
- **Build System**: Build Editor/Game targets with full diagnostics integration
- **Live Coding**: Trigger Live Coding compiles and track status
- **Run Control**: Play In Editor (PIE), Standalone, Dedicated Server
- **Real-time Logging**: Stream Unreal logs with filters and search
- **IntelliSense**: Generate `compile_commands.json` for clangd
- **Asset Management**: Create, rename, delete Blueprints and assets
- **Performance Profiling**: CPU/GPU/memory profiling with dashboards

## Architecture

```
Cursor Extension (TypeScript) ⇄ WebSocket IPC ⇄ Unreal Engine Plugin (C++)
```

- **IPC Transport**: WebSocket on localhost (default port 17777)
- **Message Format**: JSON-RPC-like with request/response/event types
- **Threading**: All Unreal API access marshaled to Game Thread
- **State Management**: Extension tracks connection/build/PIE state; plugin tracks active operations

## Quick Start

### 1. Install Unreal Engine Plugin

See [`unreal-plugin/README.md`](unreal-plugin/README.md) for detailed installation instructions.

Quick steps:
1. Copy `unreal-plugin` to `YourProject/Plugins/UnrealCursorBridge/`
2. Regenerate project files
3. Open project in Unreal Editor (plugin loads automatically)

### 2. Install Cursor Extension

#### Development
```bash
cd cursor-extension
npm install
npm run compile
```

Press F5 in Cursor to launch Extension Development Host.

#### Package
```bash
npm run package
code --install-extension unreal-cursor-integration-0.1.0.vsix
```

### 3. Connect

1. Open an Unreal Engine project in Cursor
2. Open the "Unreal Engine" view in the Activity Bar
3. Click "Connect"
4. Status bar shows connection state

## Configuration

### Extension Settings

Open Settings (Ctrl+, / Cmd+,) and search for "Unreal":
- **Port**: WebSocket port (default: 17777)
- **Auth Token**: Optional authentication token
- **Auto Connect**: Automatically connect when workspace opens
- **Log Level**: Extension logging verbosity

### Plugin Configuration

The plugin starts a WebSocket server on `127.0.0.1:17777` by default. To change the port, modify `unreal-plugin/Source/UnrealCursorBridge/Private/IPC/IPCServer.cpp`.

## Features

### Phase 0: UI Foundation ✅
- Activity Bar container with tree view
- Status bar items (connection, Live Coding, PIE, build)
- Command palette integration
- View/title toolbar buttons

### Phase 1: Basic Connection ✅
- WebSocket IPC client/server
- Capability negotiation handshake
- Connection state management
- Settings integration

### Phase 2: Build System (In Progress)
- UBT invocation (cross-platform)
- Build diagnostics → VS Code Problems panel
- Build progress tracking
- Cancellation support

### Phase 3: Live Coding (Planned)
- Live Coding compile trigger
- Status tracking
- Graceful fallback to full build

### Phase 4: Real-time Logging (Planned)
- Log streaming with filters
- Logs webview
- Export to JSON

### Phase 5: IntelliSense (Planned)
- Generate `compile_commands.json` via UBT
- UHT diagnostics
- clangd integration

### Phase 6: Asset Management (Planned)
- Blueprint/asset CRUD operations
- Transaction support
- Blueprint graph export

### Phase 7: Performance Profiling (Planned)
- Stats collection (CPU/GPU/memory)
- Unreal Insights integration
- Performance dashboard

## API Contract

See [`API_CONTRACT.md`](API_CONTRACT.md) for complete IPC method/event reference.

## Requirements

- **Unreal Engine**: 5.6+
- **Node.js**: 20+ (LTS)
- **VS Code/Cursor**: 1.80+
- **Platforms**: Windows, macOS, Linux

## Troubleshooting

### Connection Issues
- Verify Unreal Editor is running
- Check plugin is enabled (Edit → Plugins)
- Ensure port 17777 is not in use
- Check firewall allows localhost connections

### Build Issues
- Verify UnrealBuildTool is accessible
- Check engine path configuration
- Review build output in Output Channel

### Plugin Issues
- Check Editor log: `Saved/Logs/Editor.log`
- Verify plugin is in correct location: `Plugins/UnrealCursorBridge/`
- Ensure all required modules are available

## Development

### Extension Development
```bash
cd cursor-extension
npm install
npm run watch  # Watch mode for development
```

### Plugin Development
1. Modify C++ source files
2. Close Unreal Editor
3. Rebuild plugin
4. Reopen project

## License

See individual component licenses.

## Contributing

This is a reference implementation. Contributions welcome via pull requests.

