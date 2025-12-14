# Unreal Engine Cursor Bridge Plugin

Unreal Engine Editor plugin providing IPC server for Cursor/VS Code integration.

## Installation

1. Copy the `UnrealCursorBridge` folder to your project's `Plugins` directory:
   ```
   YourProject/Plugins/UnrealCursorBridge/
   ```

2. If the `Plugins` directory doesn't exist, create it at the root of your project.

3. Regenerate project files:
   - Right-click your `.uproject` file
   - Select "Generate Visual Studio project files" (Windows)
   - Or run: `UnrealVersionSelector.exe /projectfiles "path/to/YourProject.uproject"`

4. Open your project in Unreal Editor. The plugin should load automatically.

5. Verify the plugin is enabled:
   - Edit → Plugins
   - Search for "Unreal Cursor Bridge"
   - Ensure it's checked/enabled

## Compilation

### Windows
1. Open your project's `.sln` file in Visual Studio
2. Build the `UnrealCursorBridge` module
3. Or build from command line:
   ```
   "C:\Program Files\Epic Games\UE_5.6\Engine\Build\BatchFiles\Build.bat" UnrealCursorBridgeEditor Win64 Development "C:\Path\To\YourProject\YourProject.uproject" -WaitMutex
   ```

### macOS/Linux
1. Open your project in Unreal Editor
2. The plugin will compile automatically when the project is opened
3. Or build from command line:
   ```
   Engine/Build/BatchFiles/RunUBT.sh UnrealCursorBridgeEditor Mac Development -Project="path/to/YourProject.uproject"
   ```

## Configuration

The plugin starts a WebSocket server on `127.0.0.1:17777` by default.

To change the port, modify `IPCServer.cpp`:
```cpp
Port = 17777; // Change this value
```

## Troubleshooting

### Plugin doesn't load
- Check that the plugin is in the correct location: `YourProject/Plugins/UnrealCursorBridge/`
- Verify `UnrealCursorBridge.uplugin` exists and is valid JSON
- Check Editor log for errors: `Saved/Logs/Editor.log`

### WebSocket server fails to start
- Check if port 17777 is already in use
- Verify firewall allows localhost connections
- Check Editor log for WebSocket errors

### Build errors
- Ensure you have UE 5.6+ installed
- Verify all required modules are available (WebSockets, AssetTools, etc.)
- Check that `UnrealCursorBridge.Build.cs` has correct module dependencies

### Connection issues
- Ensure the Cursor extension is configured with the correct port
- Check that the Editor is running (plugin only works in Editor, not packaged games)
- Verify localhost connectivity: `telnet 127.0.0.1 17777`

## Architecture

The plugin provides:
- **IPC Server**: WebSocket server for communication with Cursor extension
- **Message Handlers**: Request/response handlers for various operations
- **Game Thread Safety**: All Unreal API access is marshaled to the Game Thread

## Development

To modify the plugin:
1. Make changes to source files
2. Close Unreal Editor
3. Rebuild the plugin
4. Reopen the project

Hot reload is not supported for plugins - you must rebuild and restart the editor.

