# Testing the Connection

This guide will help you verify that the connection between the Cursor extension and Unreal Engine plugin is working correctly.

## Prerequisites

Before testing, ensure:

1. **Unreal Engine Editor is running** with your project open
2. **Plugin is enabled**:
   - In Unreal Editor: `Edit → Plugins`
   - Search for "UnrealCursorBridge"
   - Verify it's checked/enabled
3. **Extension is installed** in Cursor/VS Code
4. **Project is open** in Cursor (the workspace should contain your `.uproject` file)

## Step 1: Verify Plugin is Running

The plugin starts a WebSocket server on `127.0.0.1:17777` when the Unreal Editor loads.

### Check Plugin Logs

1. In Unreal Editor, open the **Output Log** window (`Window → Developer Tools → Output Log`)
2. Look for messages indicating the IPC server has started
3. You should see something like: `IPCServer: Started on port 17777`

### Alternative: Check Editor Log File

Check the Unreal Editor log file:
- **Windows**: `%LOCALAPPDATA%\UnrealEngine\Common\Logs\Editor.log`
- **macOS**: `~/Library/Logs/UnrealEngine/Editor.log`
- **Linux**: `~/.config/Epic/UnrealEngine/Common/Logs/Editor.log`

Search for "IPCServer" or "WebSocket" to verify the server started.

## Step 2: Connect from Cursor

### Method 1: Via Status Bar

1. Look at the bottom status bar in Cursor
2. Find the **"UE: Disconnected"** indicator (with a plug icon)
3. Click on it to connect
4. The status should change to **"UE: Connecting..."** (spinning icon)
5. Then to **"UE: Connected"** (green plug icon)

### Method 2: Via Tree View

1. Open the **Activity Bar** (left sidebar)
2. Click the **Unreal Engine** icon (or use `Ctrl+Shift+P` → "View: Show Unreal Engine")
3. Expand the **Connection** section
4. Click **"Connect"**

### Method 3: Via Command Palette

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
2. Type `Unreal: Connect`
3. Press Enter

## Step 3: Verify Connection Status

### Visual Indicators

After connecting, you should see:

1. **Status Bar**:
   - Changes from `$(plug) UE: Disconnected` (red background)
   - To `$(plug) UE: Connected` (normal background)

2. **Tree View**:
   - Connection section shows: `Connection: Connected` (with plug icon)
   - Expand it to see:
     - Project name
     - Engine version
     - "Disconnect" option

3. **Output Channel**:
   - Open Output panel (`Ctrl+Shift+U` or `View → Output`)
   - Select **"Unreal Integration"** from the dropdown
   - You should see:
     ```
     Connecting to Unreal Engine Editor...
     Connected to Unreal Engine Editor
     Connected to project: YourProjectName (5.6.0)
     ```

## Step 4: Test Basic Functionality

### Test 1: Check Project Info

1. In the **Unreal Engine** tree view, expand **Connection**
2. You should see:
   - `Project: YourProjectName`
   - `Engine: 5.6.0` (or your engine version)

If these appear, the handshake completed successfully!

### Test 2: Test Ping (Manual)

You can test the connection programmatically using the Developer Console:

1. Press `Ctrl+Shift+P` → `Developer: Open Developer Tools`
2. In the Console tab, run:
   ```javascript
   // Get the extension API
   const extension = vscode.extensions.getExtension('your-extension-id');
   // This requires access to the extension's internal API
   ```

Alternatively, you can test by using any command that requires a connection:

### Test 3: Test Status Command

Try using a command that queries the server:

1. Press `Ctrl+Shift+P`
2. Type `Unreal: Get Project Info` (if available)
3. Or try `Unreal: Play In Editor` - this will fail gracefully if not connected, or work if connected

### Test 4: Test Simple Command

1. In the **Unreal Engine** tree view, expand **Run**
2. Click **"Play In Editor"**
3. If connected:
   - You'll see a notification: "Play In Editor started"
   - The PIE status bar item will show "PIE: Running"
   - Unreal Editor will start PIE
4. If not connected:
   - You'll see an error: "Failed to connect to Unreal Engine Editor"

## Step 5: Monitor Connection Health

### Check Output Channel

The **"Unreal Integration"** output channel shows all connection activity:

- Connection attempts
- Request/response messages
- Errors and warnings
- Build progress
- Event notifications

Keep this open while testing to see real-time communication.

### Check Status Bar Items

After connecting, you should see multiple status bar items:

- **UE: Connected** - Main connection status
- **PIE: Stopped** - Play In Editor status (if connected)
- Other items appear as features are used

## Troubleshooting

### Connection Fails Immediately

**Symptoms**: Status shows "Disconnected" immediately after clicking Connect

**Possible Causes**:
1. **Unreal Editor not running**
   - Solution: Open Unreal Editor with your project

2. **Plugin not enabled**
   - Solution: `Edit → Plugins` → Enable "UnrealCursorBridge"
   - Restart Unreal Editor

3. **Port 17777 in use**
   - Solution: Check if another process is using the port
   - Windows: `netstat -ano | findstr :17777`
   - macOS/Linux: `lsof -i :17777`
   - Change port in Cursor settings if needed

4. **Firewall blocking connection**
   - Solution: Allow localhost connections on port 17777

### Connection Times Out

**Symptoms**: Status shows "Connecting..." for a long time, then fails

**Possible Causes**:
1. **Wrong port configured**
   - Solution: Check settings (`Ctrl+,` → search "unreal" → verify Port is 17777)

2. **Plugin server not started**
   - Solution: Check Unreal Editor logs for errors
   - Verify plugin compiled successfully

3. **Network issues**
   - Solution: Verify `127.0.0.1` is accessible
   - Try `ping 127.0.0.1`

### Connection Succeeds but Commands Fail

**Symptoms**: Status shows "Connected" but commands don't work

**Possible Causes**:
1. **Handshake failed**
   - Check Output channel for errors
   - Verify project path is correct

2. **Method not implemented**
   - Some features may not be fully implemented yet
   - Check `API_CONTRACT.md` for available methods

3. **Capability mismatch**
   - Some features require specific Unreal Engine versions
   - Check capabilities in Connection tree view

## Advanced Testing

### Test WebSocket Connection Directly

You can test the WebSocket server directly using a tool like `wscat`:

```bash
# Install wscat (requires Node.js)
npm install -g wscat

# Connect to the server
wscat -c ws://127.0.0.1:17777

# Send a test message (JSON-RPC format)
{"id":"test-1","type":"request","method":"ping","params":{}}
```

Expected response:
```json
{"id":"test-1","type":"response","result":{"pong":"pong"}}
```

### Monitor Network Traffic

Use a tool like Wireshark or Fiddler to monitor WebSocket traffic:
- Filter: `tcp.port == 17777`
- You should see WebSocket frames with JSON messages

## Success Criteria

Your connection is working correctly if:

✅ Status bar shows "UE: Connected"  
✅ Tree view shows project name and engine version  
✅ Output channel shows "Connected to Unreal Engine Editor"  
✅ You can execute commands (e.g., Play In Editor)  
✅ Status bar items update based on Unreal Editor state  
✅ No errors in Output channel  

## Next Steps

Once connection is verified:

1. **Test Build System**: Try building the Editor or Game target
2. **Test Live Coding**: Enable and trigger a Live Coding compile
3. **Test Logging**: Subscribe to logs and see real-time output
4. **Test Profiling**: Start a profiling session
5. **Test Asset Operations**: Create, rename, or delete assets

Refer to the main `README.md` for feature documentation.

