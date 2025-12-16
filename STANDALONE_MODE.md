# Standalone Mode for UHT and IntelliSense

## Overview

The extension now supports **standalone mode** for UHT (Unreal Header Tool) and IntelliSense generation. This allows you to use these features **without requiring Unreal Editor to be running**.

## What Works in Standalone Mode

### ✅ UHT (Unreal Header Tool)
- **Run UHT checks** without editor connection
- **Auto-detect errors** in your C++ code
- **Show diagnostics** in Problems panel
- Works by calling UnrealBuildTool directly

### ✅ IntelliSense (compile_commands.json)
- **Generate compile_commands.json** without editor connection
- **Auto-regenerate** on file changes (if enabled)
- **Works with clangd** for C++ IntelliSense
- Works by calling UnrealBuildTool directly

### ❌ Reflection System
- **Requires editor** - Reflection data is only available when editor is running
- Hover provider, completion provider, and reflection-based diagnostics need editor connection

## How It Works

The extension automatically detects whether the editor is connected:

1. **If Editor is Connected:**
   - Uses plugin IPC (faster, more reliable)
   - Full feature set available

2. **If Editor is NOT Connected:**
   - Automatically falls back to standalone mode
   - Runs UnrealBuildTool/UHT directly via command line
   - Works for UHT checks and compile_commands.json generation

## Usage

### Manual Commands

Both commands work in standalone mode:

1. **Generate compile_commands.json**
   - Command: `Unreal: Generate compile_commands.json`
   - Works with or without editor connection
   - Prompts for target, platform, and configuration

2. **Run UHT Check**
   - Command: `Unreal: Run UHT Check`
   - Works with or without editor connection
   - Shows diagnostics in Problems panel

### Automatic Features

If enabled in settings, these work automatically:

1. **Auto-regenerate compile_commands.json**
   - Setting: `unreal.intellisense.autoRegenerate` (default: `true`)
   - Triggers on file save/change (debounced)
   - Works in standalone mode if editor not connected

2. **Auto UHT check**
   - Setting: `unreal.intellisense.autoUHTCheck` (default: `true`)
   - Triggers on file save/change (debounced)
   - Works in standalone mode if editor not connected

## Configuration

### Enable/Disable Standalone Mode

```json
{
  "unreal.intellisense.standaloneMode": true
}
```

- **Default:** `true` (enabled)
- When enabled: Automatically uses standalone mode if editor not connected
- When disabled: Requires editor connection for all IntelliSense/UHT features

### Required Paths

Standalone mode requires UnrealBuildTool to be found. The extension will:

1. Check manual settings first:
   - `unreal.buildToolPath` - Direct path to UnrealBuildTool
   - `unreal.engineRoot` - Engine root (used to find UnrealBuildTool)

2. Auto-detect from:
   - `.uproject` file (EngineAssociation)
   - Common installation locations
   - Windows Registry (Epic Games Launcher)

## Requirements

### For Standalone Mode to Work

1. **UnrealBuildTool must be accessible**
   - Either configured manually in settings
   - Or auto-detected from engine installation

2. **Valid .uproject file**
   - Must be in workspace root
   - Used to determine project configuration

3. **Unreal Engine installation**
   - Can be installed or source build
   - Must have UnrealBuildTool executable

## Performance

### Standalone Mode vs Plugin Mode

- **Plugin Mode (Editor Connected):**
  - Faster (direct API calls)
  - More reliable (uses editor's build system)
  - Better error reporting

- **Standalone Mode (Editor Not Connected):**
  - Slightly slower (spawns processes)
  - Still reliable (uses same UnrealBuildTool)
  - Good error reporting (parses output)

## Troubleshooting

### "UnrealBuildTool not found"

**Solution:**
1. Configure `unreal.buildToolPath` in settings
2. Or configure `unreal.engineRoot` (extension will find UnrealBuildTool)
3. Check that Unreal Engine is installed

### "No .uproject file found"

**Solution:**
1. Ensure workspace root contains a `.uproject` file
2. Open the folder containing the `.uproject` file as workspace

### Standalone Mode Not Working

**Check:**
1. Is `unreal.intellisense.standaloneMode` set to `true`?
2. Is UnrealBuildTool accessible? (check Output panel)
3. Does the `.uproject` file exist and is valid?

## Benefits

1. **Faster Development**
   - Don't need to start editor for basic checks
   - Get error detection while coding
   - Generate IntelliSense without editor

2. **Lower Resource Usage**
   - Editor doesn't need to be running
   - Saves memory and CPU

3. **Better CI/CD Integration**
   - Can run UHT checks in CI pipelines
   - Generate compile_commands.json in build scripts

4. **Flexibility**
   - Works even if editor crashes
   - Works on remote machines without editor
   - Works in headless environments

## Limitations

1. **Reflection System Still Requires Editor**
   - Hover provider needs editor for reflection data
   - Completion provider reflection enhancements need editor
   - Reflection-based diagnostics need editor

2. **No Real-time Updates**
   - Standalone mode runs on-demand or on save
   - Not as real-time as plugin mode

3. **Process Overhead**
   - Spawns UnrealBuildTool processes
   - Slightly slower than plugin mode

## Example Workflow

### Without Editor Running

1. Open Unreal project in Cursor
2. Edit C++ files
3. Save file → Auto UHT check runs (standalone mode)
4. See errors in Problems panel
5. Generate compile_commands.json → Works (standalone mode)
6. Get IntelliSense from clangd

### With Editor Running

1. Open Unreal project in Cursor
2. Connect to editor
3. Edit C++ files
4. Save file → Auto UHT check runs (plugin mode, faster)
5. See errors in Problems panel
6. Hover over symbols → See reflection data
7. Generate compile_commands.json → Works (plugin mode, faster)

## Summary

**Standalone mode enables:**
- ✅ UHT checks without editor
- ✅ compile_commands.json generation without editor
- ✅ Auto-detection and auto-fallback
- ✅ Same diagnostics and error reporting

**Still requires editor for:**
- ❌ Reflection system features
- ❌ Hover provider (reflection data)
- ❌ Enhanced completion (reflection data)

The extension automatically chooses the best mode based on connection status, giving you the best of both worlds!

