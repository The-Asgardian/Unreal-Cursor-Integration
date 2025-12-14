# Troubleshooting Guide

## Extension Stuck on "Activating..."

If the extension shows "Activating..." but never completes:

### Step 1: Check Extension Host Logs

1. Press `Ctrl+Shift+U` to open Output panel
2. Select **"Log (Extension Host)"** from the dropdown
3. Look for error messages related to "unreal-cursor-integration"
4. Common errors:
   - `Cannot find module '...'` - Missing dependency
   - `SyntaxError` - Compilation error
   - `TypeError` - Runtime error

### Step 2: Check Developer Console

1. Press `Ctrl+Shift+P`
2. Type `Developer: Toggle Developer Tools`
3. Go to the **Console** tab
4. Look for red error messages
5. Filter by typing "unreal" or "extension" in the console filter

### Step 3: Recompile the Extension

The extension may have compilation errors:

```bash
cd cursor-extension
npm run compile
```

Check for any TypeScript errors in the output.

### Step 4: Check for Missing Dependencies

```bash
cd cursor-extension
npm install
npm run compile
```

### Step 5: Check Compiled Output

Verify the compiled files exist:

```bash
# Windows
dir cursor-extension\out\extension.js

# macOS/Linux
ls cursor-extension/out/extension.js
```

If the file doesn't exist or is outdated, recompile.

### Step 6: Reinstall the Extension

If the above steps don't work:

1. **Uninstall**:
   - Press `Ctrl+Shift+X`
   - Find "Unreal Engine Cursor Integration"
   - Click the gear icon → Uninstall

2. **Recompile and reinstall**:
   ```bash
   cd cursor-extension
   npm run compile
   npm run package
   cursor --install-extension unreal-cursor-integration-0.1.0.vsix --force
   ```

3. **Reload Cursor**: `Ctrl+Shift+P` → "Reload Window"

### Step 7: Check for Import Errors

The extension now has better error handling. After reloading, check:
- Extension Host logs for specific error messages
- Developer Console for stack traces
- The error messages will now show which component failed to initialize

## Command Not Found Error

If you see the error: `Error running command unreal.connect: command 'unreal.connect' not found`, follow these steps:

### Step 1: Reload Cursor Window

The most common cause is that Cursor hasn't reloaded after installing the extension.

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
2. Type `Developer: Reload Window`
3. Press Enter
4. Wait for Cursor to reload
5. Try the command again

### Step 2: Verify Extension is Installed

1. Press `Ctrl+Shift+X` to open Extensions view
2. Search for "Unreal Engine Cursor Integration"
3. Verify it's installed and enabled
4. If not installed, install it:
   ```bash
   cd cursor-extension
   npm run package
   code --install-extension unreal-cursor-integration-0.1.0.vsix
   ```

### Step 3: Check Extension Activation

1. Press `Ctrl+Shift+P`
2. Type `Developer: Show Running Extensions`
3. Look for "unreal-cursor-integration"
4. Check if it shows as "Activated" or has any errors

### Step 4: Check Developer Console for Errors

1. Press `Ctrl+Shift+P`
2. Type `Developer: Toggle Developer Tools`
3. Go to the **Console** tab
4. Look for any red error messages related to the extension
5. Common errors:
   - Module not found: Check if `out/extension.js` exists
   - Activation failed: Check for syntax errors in the extension code

### Step 5: Recompile the Extension

If you've made changes to the extension code:

```bash
cd cursor-extension
npm run compile
```

Then reload Cursor (Step 1).

### Step 6: Reinstall the Extension

If the above steps don't work:

1. **Uninstall the extension**:
   - Press `Ctrl+Shift+X`
   - Find "Unreal Engine Cursor Integration"
   - Click the gear icon → Uninstall

2. **Reinstall**:
   ```bash
   cd cursor-extension
   npm run compile
   npm run package
   code --install-extension unreal-cursor-integration-0.1.0.vsix
   ```

3. **Reload Cursor** (Step 1)

### Step 7: Check Extension Output

1. Press `Ctrl+Shift+U` to open Output panel
2. Select **"Log (Extension Host)"** from the dropdown
3. Look for messages like:
   - `Unreal Engine Cursor Integration extension is now active`
   - Any error messages

### Step 8: Verify package.json Commands

The commands must be registered in `package.json`. Verify that `unreal.connect` is listed in the `contributes.commands` section.

If it's missing, the extension needs to be recompiled and reinstalled.

## Connection Issues

### Extension Commands Work But Connection Fails

If commands are available but connection fails:

1. **Check Unreal Editor is Running**
   - Open your Unreal project in Unreal Editor
   - Verify the plugin is enabled (`Edit → Plugins`)

2. **Check Port Configuration**
   - Press `Ctrl+,` to open Settings
   - Search for "unreal"
   - Verify Port is set to `17777` (or your configured port)

3. **Check Plugin Logs**
   - In Unreal Editor: `Window → Developer Tools → Output Log`
   - Look for "IPCServer" messages
   - Should see: "IPCServer: Started on port 17777"

4. **Test WebSocket Connection**
   ```bash
   # Install wscat
   npm install -g wscat
   
   # Test connection
   wscat -c ws://127.0.0.1:17777
   ```

### Extension Not Activating

If the extension doesn't activate at all:

1. **Check Activation Events**
   - The extension uses `onStartupFinished` activation
   - It should activate automatically when Cursor starts

2. **Check for Conflicting Extensions**
   - Disable other extensions temporarily
   - See if the issue persists

3. **Check Cursor Version**
   - Extension requires Cursor/VS Code 1.80.0 or higher
   - Check version: `Help → About`

## Quick Fix Checklist

- [ ] Reloaded Cursor window (`Ctrl+Shift+P` → "Reload Window")
- [ ] Extension is installed and enabled
- [ ] Extension shows as "Activated" in running extensions
- [ ] No errors in Developer Console
- [ ] Extension compiled successfully (`npm run compile`)
- [ ] `out/extension.js` exists and is up to date
- [ ] Unreal Editor is running with plugin enabled
- [ ] Port 17777 is not blocked by firewall

## Still Having Issues?

1. **Check the logs**:
   - Extension Host logs: `Ctrl+Shift+U` → "Log (Extension Host)"
   - Developer Console: `Ctrl+Shift+P` → "Developer: Toggle Developer Tools"

2. **Verify installation**:
   ```bash
   # Check if extension files exist
   ls cursor-extension/out/extension.js
   
   # Recompile if needed
   cd cursor-extension
   npm run compile
   ```

3. **Test in VS Code**:
   - Try installing in VS Code instead of Cursor
   - This helps isolate if it's a Cursor-specific issue

4. **Report the issue**:
   - Include error messages from Developer Console
   - Include Extension Host logs
   - Include your Cursor version (`Help → About`)

