# IPC API Contract

Complete reference for IPC methods and events between Cursor Extension and Unreal Engine Plugin.

## Message Format

### Request
```json
{
  "id": "uuid",
  "type": "request",
  "method": "method.name",
  "params": {},
  "cancelToken": "optional-token"
}
```

### Response
```json
{
  "id": "uuid",
  "type": "response",
  "result": {},
  "error": {
    "code": "ERROR_CODE",
    "message": "Error message",
    "data": {}
  }
}
```

### Event
```json
{
  "id": "uuid",
  "type": "event",
  "event": "event.name",
  "data": {}
}
```

## Connection & Handshake

### client.hello

**Request:**
```json
{
  "workspacePath": "/path/to/workspace",
  "extensionVersion": "0.1.0",
  "clientInfo": {
    "platform": "win32",
    "vscodeVersion": "1.80.0"
  }
}
```

**Response:**
```json
{
  "engineVersion": "5.6.0",
  "projectName": "MyProject",
  "projectPath": "C:/Projects/MyProject/MyProject.uproject",
  "supportedPlatforms": ["Win64", "Mac", "Linux"],
  "capabilities": {
    "liveCoding": true,
    "insights": true,
    "assetEditing": true,
    "blueprintEditing": true
  }
}
```

## Core Methods

### ping
**Request:** `{}`  
**Response:** `{ "pong": "pong" }`

### status.get
**Request:** `{}`  
**Response:** `{ "connected": true, "status": "ready" }`

### project.info
**Request:** `{}`  
**Response:** `{ "projectName": "...", "projectPath": "..." }`

## Build System

### build.start
**Request:**
```json
{
  "target": "Editor",
  "configuration": "Development",
  "platform": "Win64",
  "projectPath": "...",
  "extraArgs": []
}
```

**Response:** `{ "buildId": "uuid" }`

**Events:**
- `build.progress`: `{ "percent": 50, "phase": "Compiling" }`
- `build.outputLine`: `{ "line": "...", "category": "..." }`
- `build.diagnostic`: `{ "file": "...", "line": 10, "column": 5, "severity": "error", "message": "..." }`
- `build.finished`: `{ "success": true, "duration": 120.5 }`

### build.cancel
**Request:** `{ "buildId": "uuid" }`  
**Response:** `{ "cancelled": true }`

### build.listTargets
**Request:** `{}`  
**Response:** `{ "targets": ["Editor", "Game"], "configurations": ["Debug", "Development", "Shipping"], "platforms": ["Win64"] }`

## Live Coding

### livecoding.status
**Request:** `{}`  
**Response:** `{ "enabled": true, "compiling": false, "lastResult": "success" }`

### livecoding.enable
**Request:** `{ "enabled": true }`  
**Response:** `{ "enabled": true }`

**Events:**
- `livecoding.statusChanged`: `{ "enabled": true, "compiling": false }`
- `livecoding.outputLine`: `{ "line": "..." }`

### livecoding.compile
**Request:** `{}`  
**Response:** `{ "started": true }`

### livecoding.restart
**Request:** `{}`  
**Response:** `{ "restarted": true }`

## Run Control

### run.playPIE
**Request:** `{}`  
**Response:** `{ "started": true }`

**Events:**
- `run.pieStatus`: `{ "running": true }`
- `run.gameStarted`: `{}`
- `run.gameStopped`: `{}`

### run.stopPIE
**Request:** `{}`  
**Response:** `{ "stopped": true }`

### run.standalone
**Request:** `{}`  
**Response:** `{ "started": true }`

### run.dedicatedServer
**Request:** `{}`  
**Response:** `{ "started": true }`

## Logging

### logs.subscribe
**Request:**
```json
{
  "categories": ["LogTemp"],
  "verbosity": "Warning",
  "search": "error"
}
```

**Response:** `{ "subscribed": true }`

**Events:**
- `logs.line`: `{ "timestamp": "...", "frame": 123, "category": "LogTemp", "verbosity": "Warning", "message": "...", "file": "...", "line": 10 }`

### logs.unsubscribe
**Request:** `{}`  
**Response:** `{ "unsubscribed": true }`

### logs.clear
**Request:** `{}`  
**Response:** `{ "cleared": true }`

### logs.setFilter
**Request:** `{ "filter": "..." }`  
**Response:** `{ "filterSet": true }`

### logs.export
**Request:** `{ "filters": {}, "timeRange": {} }`  
**Response:** `{ "logs": [...] }`

## Profiling

### profiling.start
**Request:**
```json
{
  "mode": "stats",
  "intervalMs": 1000,
  "channels": []
}
```

**Response:** `{ "sessionId": "uuid" }`

**Events:**
- `profiling.metrics`: `{ "cpuMs": 16.5, "gpuMs": 12.3, "frameMs": 16.7, "drawCalls": 1500, "primitives": 50000, "memUsedMB": 2048, "memPeakMB": 2560 }`
- `profiling.traceReady`: `{ "traceFilePath": "...", "duration": 60.0 }`

### profiling.stop
**Request:** `{}`  
**Response:** `{ "stopped": true }`

### profiling.cancel
**Request:** `{ "sessionId": "uuid" }`  
**Response:** `{ "cancelled": true }`

### profiling.snapshot
**Request:** `{}`  
**Response:** `{ "metrics": {...} }`

### profiling.exportSession
**Request:** `{ "sessionId": "uuid" }`  
**Response:** `{ "session": {...} }`

## IntelliSense

### intellisense.generateCompileCommands
**Request:** `{}`  
**Response:** `{ "path": ".vscode/compile_commands.json" }`

**Events:**
- `intellisense.compileCommandsGenerated`: `{ "path": "..." }`

### uht.runCheck
**Request:** `{}`  
**Response:** `{ "diagnostics": [...] }`

**Events:**
- `uht.diagnostic`: `{ "file": "...", "line": 10, "column": 5, "message": "...", "severity": "error" }`

## Assets

### assets.list
**Request:** `{ "path": "/Game", "classFilter": "Blueprint", "recursive": true }`  
**Response:** `{ "assets": [...] }`

### assets.create
**Request:** `{ "assetType": "Blueprint", "name": "MyBlueprint", "path": "/Game", "params": {} }`  
**Response:** `{ "objectPath": "/Game/MyBlueprint" }`

### assets.rename
**Request:** `{ "objectPath": "/Game/OldName", "newName": "NewName", "newPath": "/Game" }`  
**Response:** `{ "objectPath": "/Game/NewName" }`

### assets.delete
**Request:** `{ "objectPaths": ["/Game/Asset1", "/Game/Asset2"] }`  
**Response:** `{ "deleted": true }`

### assets.openInEditor
**Request:** `{ "objectPath": "/Game/MyBlueprint" }`  
**Response:** `{ "opened": true }`

## Blueprints

### blueprints.create
**Request:** `{ "parentClassPath": "/Script/Engine.Actor", "name": "MyBlueprint", "path": "/Game" }`  
**Response:** `{ "objectPath": "/Game/MyBlueprint" }`

### blueprints.delete
**Request:** `{ "objectPath": "/Game/MyBlueprint" }`  
**Response:** `{ "deleted": true }`

### blueprints.modify
**Request:** `{ "objectPath": "/Game/MyBlueprint", "operation": "setProperty", "params": {} }`  
**Response:** `{ "modified": true }`

### blueprints.exportGraphJson
**Request:** `{ "objectPath": "/Game/MyBlueprint" }`  
**Response:** `{ "graphJson": {...} }`

## Error Codes

- `METHOD_NOT_FOUND`: Requested method doesn't exist
- `BUILD_IN_PROGRESS`: Build operation already in progress
- `LIVE_CODING_DISABLED`: Live Coding is not enabled
- `LIVE_CODING_UNSUPPORTED`: Live Coding not available in this UE version
- `INVALID_PARAMS`: Request parameters are invalid
- `OPERATION_FAILED`: Operation failed (check error message)
- `NOT_CONNECTED`: Not connected to Unreal Engine
- `CANCELLED`: Operation was cancelled

## Capabilities

The `capabilities` object in `client.hello` response indicates available features:
- `liveCoding`: Live Coding support available
- `insights`: Unreal Insights/Trace support available
- `assetEditing`: Asset CRUD operations available
- `blueprintEditing`: Blueprint modification available

Extension MUST check capabilities before enabling UI commands for these features.

