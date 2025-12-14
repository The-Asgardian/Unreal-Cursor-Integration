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

### Automated Installation (Recommended for Quick Prototyping)

For rapid development and testing, use the auto-install scripts to automatically install both the extension and plugin:

#### Windows (PowerShell)
```powershell
# Install both extension and plugin
.\install.ps1

# Or specify project path directly
.\install.ps1 -UnrealProjectPath "C:\Path\To\YourProject\YourProject.uproject"

# Install only extension
.\install.ps1 -SkipPlugin

# Install only plugin
.\install.ps1 -SkipExtension
```

#### macOS/Linux (Bash)
```bash
# Make script executable (first time only)
chmod +x install.sh

# Install both extension and plugin
./install.sh

# Or specify project path directly
./install.sh --project-path "/path/to/YourProject/YourProject.uproject"

# Install only extension
./install.sh --skip-plugin

# Install only plugin
./install.sh --skip-extension
```

#### Using npm (Cross-platform)
```bash
# Install both (requires Node.js)
npm run install:all

# Install only extension
npm run install:extension

# Install only plugin
npm run install:plugin
```

The scripts will:
- Compile and package the Cursor extension
- Install it to Cursor/VS Code automatically
- Copy the Unreal plugin to your project's Plugins folder
- Regenerate project files (Windows only)
- Save your project path for future use

**Note**: The first time you run the script, you'll be prompted for your Unreal project path. This path is saved to `.unreal-project-path` for future runs.

### Manual Installation

#### 1. Install Unreal Engine Plugin

See [`unreal-plugin/README.md`](unreal-plugin/README.md) for detailed installation instructions.

Quick steps:
1. Copy `unreal-plugin` to `YourProject/Plugins/UnrealCursorBridge/`
2. Regenerate project files
3. Open project in Unreal Editor (plugin loads automatically)

#### 2. Install Cursor Extension

##### Development
```bash
cd cursor-extension
npm install
npm run compile
```

Press F5 in Cursor to launch Extension Development Host.

##### Package
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

### Quick Prototyping Workflow

For rapid iteration during development:

1. **Make your changes** to extension or plugin code
2. **Run the install script** to automatically reinstall:
   ```bash
   # Windows
   .\install.ps1
   
   # macOS/Linux
   ./install.sh
   
   # Or using npm
   npm run install:all
   ```
3. **Reload Cursor/VS Code** (Ctrl+Shift+P → "Reload Window")
4. **Restart Unreal Editor** if you modified the plugin

The install script handles:
- Compiling TypeScript
- Packaging the extension
- Installing to Cursor/VS Code
- Copying plugin to your Unreal project
- Regenerating project files (Windows)

### Extension Development
```bash
cd cursor-extension
npm install
npm run watch  # Watch mode for development
```

### Plugin Development
1. Modify C++ source files
2. Close Unreal Editor
3. Rebuild plugin (or run `.\install.ps1` / `./install.sh` to auto-install)
4. Reopen project

## License

See individual component licenses.

## Contributing

This is a reference implementation. Contributions welcome via pull requests.

