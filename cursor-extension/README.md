# Unreal Engine Cursor Integration - Extension

VS Code/Cursor extension for deep Unreal Engine Editor integration.

## Installation

### Development Setup

1. Install dependencies:
```bash
npm install
```

2. Compile TypeScript:
```bash
npm run compile
```

3. Press F5 in VS Code/Cursor to launch Extension Development Host

### Package Extension

```bash
npm run package
```

This creates a `.vsix` file that can be installed via:
```bash
code --install-extension unreal-cursor-integration-0.1.0.vsix
```

## Configuration

Open Settings and search for "Unreal" to configure:
- **Port**: WebSocket port (default: 17777)
- **Auth Token**: Optional authentication token
- **Auto Connect**: Automatically connect when workspace opens
- **Log Level**: Extension logging verbosity

## Usage

1. Install the Unreal Engine plugin (see `../unreal-plugin/README.md`)
2. Open an Unreal Engine project in Cursor
3. Open the Unreal Engine view in the Activity Bar
4. Click "Connect" to establish connection
5. Use the tree view or commands to interact with Unreal Engine

## Commands

All commands are prefixed with `unreal.*` and available via:
- Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
- Tree view context menus
- Status bar items

## Troubleshooting

- **Connection fails**: Ensure the Unreal Engine plugin is installed and the editor is running
- **Port conflicts**: Change the port in settings if 17777 is in use
- **Build errors**: Check that UnrealBuildTool is in your PATH or configure engine path

