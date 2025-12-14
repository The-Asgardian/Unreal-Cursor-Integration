---
name: Unreal Engine Cursor Integration
overview: Build a production-ready, modular system providing deep Unreal Engine Editor integration inside Cursor via a VS Code extension (TypeScript) and an Unreal Engine Editor plugin (C++), with WebSocket IPC, full UI controls, build system, live coding, logging, IntelliSense, asset management, and performance profiling.
todos: []
---

# Unreal Engine Cursor Integration - Architecture Plan

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Cursor Extension                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   UI Layer   │  │  Commands    │  │  Webviews    │    │
│  │ Tree/Status  │  │   Registry   │  │  Logs/Perf   │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                 │                  │             │
│  ┌──────▼─────────────────▼──────────────────▼───────┐    │
│  │           IPC Client (WebSocket)                  │    │
│  │  - Connection Manager                             │    │
│  │  - Request/Response Handler                       │    │
│  │  - Event Stream Subscriber                        │    │
│  └───────────────────┬───────────────────────────────┘    │
└──────────────────────┼────────────────────────────────────┘
                        │ WebSocket (localhost:17777)
                        │ JSON-RPC-like messages
┌───────────────────────▼────────────────────────────────────┐
│              Unreal Engine Editor Plugin                   │
│  ┌────────────────────────────────────────────────────┐   │
│  │         IPC Server (WebSocket Module)              │   │
│  │  - Request Router                                  │   │
│  │  - Event Publisher                                 │   │
│  └──────┬─────────────────────────────────────────────┘   │
│         │                                                   │
│  ┌──────▼──────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Build Module   │  │ Live Coding  │  │  Logs Module │ │
│  │  (UBT Wrapper)  │  │   Module     │  │  (OutputDev) │ │
│  └─────────────────┘  └──────────────┘  └──────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Run Module  │  │ Intellisense │  │  Profiling   │   │
│  │  (PIE/Server)│  │  (UHT/UBT)   │  │  (Stats/Trace)│   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│  ┌──────────────┐  ┌──────────────┐                     │
│  │  Assets      │  │  Runtime     │                     │
│  │  (AssetTools)│  │  State Track  │                     │
│  └──────────────┘  └──────────────┘                     │
└───────────────────────────────────────────────────────────┘
```

## Repository Structure

```
UnrealEngine Integration/
├── cursor-extension/
│   ├── package.json
│   ├── tsconfig.json
│   ├── webpack.config.js
│   ├── .vscodeignore
│   ├── src/
│   │   ├── extension.ts              # Entry point
│   │   ├── ipc/
│   │   │   ├── client.ts             # WebSocket client
│   │   │   ├── protocol.ts           # Message types/schemas
│   │   │   └── connectionManager.ts  # Connection lifecycle
│   │   ├── ui/
│   │   │   ├── treeView.ts           # Tree data provider
│   │   │   ├── statusBar.ts          # Status bar items
│   │   │   └── webviews/
│   │   │       ├── logsView.ts
│   │   │       └── profilingView.ts
│   │   ├── commands/
│   │   │   ├── build.ts
│   │   │   ├── liveCoding.ts
│   │   │   ├── run.ts
│   │   │   ├── assets.ts
│   │   │   └── profiling.ts
│   │   ├── diagnostics/
│   │   │   └── buildDiagnostics.ts   # UBT error → VS Code Diagnostic
│   │   └── state/
│   │       └── connectionState.ts    # Global state manager
│   ├── media/
│   │   └── icons/                     # SVG icons for tree/status
│   └── README.md
├── unreal-plugin/
│   ├── UnrealCursorBridge.uplugin
│   ├── Source/
│   │   └── UnrealCursorBridge/
│   │       ├── UnrealCursorBridge.Build.cs
│   │       ├── Public/
│   │       │   ├── UnrealCursorBridge.h
│   │       │   ├── IPC/
│   │       │   │   ├── IPCProtocol.h
│   │       │   │   ├── IPCServer.h
│   │       │   │   └── MessageTypes.h
│   │       │   ├── Build/
│   │       │   │   └── BuildManager.h
│   │       │   ├── LiveCoding/
│   │       │   │   └── LiveCodingManager.h
│   │       │   ├── Run/
│   │       │   │   └── RunManager.h
│   │       │   ├── Logs/
│   │       │   │   └── LogCaptureDevice.h
│   │       │   ├── Assets/
│   │       │   │   └── AssetOperations.h
│   │       │   ├── Intellisense/
│   │       │   │   └── IntellisenseGenerator.h
│   │       │   └── Profiling/
│   │       │       └── ProfilingManager.h
│   │       └── Private/
│   │           ├── UnrealCursorBridge.cpp
│   │           ├── IPC/
│   │           │   ├── IPCServer.cpp
│   │           │   └── MessageHandler.cpp
│   │           ├── Build/
│   │           │   └── BuildManager.cpp
│   │           ├── LiveCoding/
│   │           │   └── LiveCodingManager.cpp
│   │           ├── Run/
│   │           │   └── RunManager.cpp
│   │           ├── Logs/
│   │           │   └── LogCaptureDevice.cpp
│   │           ├── Assets/
│   │           │   └── AssetOperations.cpp
│   │           ├── Intellisense/
│   │           │   └── IntellisenseGenerator.cpp
│   │           └── Profiling/
│   │               └── ProfilingManager.cpp
│   └── README.md
├── API_CONTRACT.md
└── README.md
```

## IPC Protocol Design

### Message Format

```typescript
interface BaseMessage {
  id: string;                    // UUID for request/response correlation
  type: "request" | "response" | "event";
}

interface RequestMessage extends BaseMessage {
  type: "request";
  method: string;                 // e.g., "build.start", "logs.subscribe"
  params: Record<string, any>;
  cancelToken?: string;           // Optional cancellation token for long-running ops
}

interface ResponseMessage extends BaseMessage {
  type: "response";
  result?: any;
  error?: {
    code: string;
    message: string;
    data?: any;
  };
}

interface EventMessage extends BaseMessage {
  type: "event";
  event: string;                  // e.g., "logs.line", "build.progress"
  data: any;
}
```

### Connection Handshake

1. Extension connects to `ws://127.0.0.1:17777` (configurable port)
2. Optional: Token-based auth if enabled
3. Extension sends `client.hello` with workspace info:
   ```typescript
   {
     id: "uuid",
     type: "request",
     method: "client.hello",
     params: {
       workspacePath: string,
       extensionVersion: string,
       clientInfo: {...}
     }
   }
   ```

4. Plugin responds with `client.hello` response containing:
   ```typescript
   {
     id: "uuid",
     type: "response",
     result: {
       engineVersion: string,
       projectName: string,
       projectPath: string,
       supportedPlatforms: string[],
       capabilities: {
         liveCoding: boolean,
         insights: boolean,
         assetEditing: boolean,
         blueprintEditing: boolean
       }
     }
   }
   ```

5. Extension MUST check capabilities before enabling UI commands
6. Connection established, bidirectional communication begins

## Phase Implementation Plan

### Phase 0: UI Foundation (Control Center)

**Files to create:**

- `cursor-extension/src/extension.ts` - Extension activation, command registration
- `cursor-extension/src/ui/treeView.ts` - Tree data provider with sections
- `cursor-extension/src/ui/statusBar.ts` - Status bar items
- `cursor-extension/package.json` - Contribution points, commands, views
- `cursor-extension/media/icons/*.svg` - Icons for tree items

**Key implementation:**

- Activity Bar container "Unreal" with tree view
- All command IDs registered (unreal.*)
- Tree sections: Connection, Build, Live Coding, Run, Logs, Performance
- Add Run module commands (separate from Build/LiveCoding)
- Status bar items: Connection state, Live Coding state, PIE state, Build indicator
- View/title toolbar buttons for common actions
- **UI commands must check capabilities before enabling** (disable if capability unavailable)

### Phase 1: Basic Connection + Settings

**Files to create:**

- `cursor-extension/src/ipc/client.ts` - WebSocket client implementation
- `cursor-extension/src/ipc/protocol.ts` - TypeScript message schemas
- `cursor-extension/src/ipc/connectionManager.ts` - Connection lifecycle
- `cursor-extension/src/state/connectionState.ts` - Global state (includes capabilities)
- `unreal-plugin/Source/.../IPC/IPCServer.h/cpp` - WebSocket server
- `unreal-plugin/Source/.../IPC/MessageHandler.h/cpp` - Request routing

**Key implementation:**

- VS Code settings: port, auth token, auto-connect, log level
- WebSocket server in UE plugin (Editor startup/shutdown hooks)
- **Handshake protocol with capability negotiation**:
  - Extension sends client.hello with workspace info
  - Plugin responds with engineVersion, projectName, projectPath, supportedPlatforms, capabilities
  - Extension stores capabilities and enables/disables UI commands accordingly
- Methods: ping, status.get, project.info
- Connection retry with exponential backoff
- OutputChannel for traces
- **Game Thread marshaling**: All IPC message handlers marshal Unreal API calls to Game Thread

### Phase 2: Build System + Diagnostics

**Files to create:**

- `cursor-extension/src/commands/build.ts` - Build command handlers
- `cursor-extension/src/diagnostics/buildDiagnostics.ts` - UBT error parsing
- `unreal-plugin/Source/.../Build/BuildManager.h/cpp` - UBT invocation

**Key implementation:**

- Build target enumeration (Editor/Game, configs, platforms)
- `build.start` method with UBT invocation (cross-platform)
- `build.cancel(buildId)` method for cancellation support
- UBT invocation strategy:
  - Detect engine type: Installed Engine vs Source Engine (FApp::IsInstalled)
  - Platform-specific wrappers:
    - Windows: UnrealBuildTool.exe (installed) or Engine/Build/BatchFiles/Build.bat (source)
    - macOS/Linux: Engine/Build/BatchFiles/RunUBT.sh or Build.sh
  - Abstract build execution behind BuildStrategy class (not hardcoded paths)
  - Detect engine path via FPaths / project settings
- Event streaming: build.progress, build.outputLine, build.diagnostic, build.finished
- Parse UBT output into VS Code Diagnostics (file/line/severity)
- Build lock to prevent concurrent builds
- Progress indication in UI
- All UBT operations run on background threads; results marshaled to Game Thread

### Phase 3: Live Coding

**Files to create:**

- `cursor-extension/src/commands/liveCoding.ts` - Live coding commands
- `unreal-plugin/Source/.../LiveCoding/LiveCodingManager.h/cpp` - Live Coding API wrapper

**Key implementation:**

- Methods: livecoding.status, livecoding.enable, livecoding.compile, livecoding.restart
- Events: livecoding.statusChanged, livecoding.outputLine
- **Reality Check**: Live Coding APIs are version-dependent and partially internal
- **Graceful Fallback**: If Live Coding unavailable or fails, fallback to full UBT build
- **UI State**: Show "Live Coding Unsupported" state instead of failing silently
- Capability check: Only enable Live Coding commands if `capabilities.liveCoding === true`
- Mutual exclusion with full builds
- Status bar integration
- **Game Thread Safety**: Live Coding operations must execute on Game Thread

### Phase 3.5: Run Module (PIE/Standalone/Server)

**Files to create:**

- `cursor-extension/src/commands/run.ts` - Run command handlers (already listed in Phase 0)
- `unreal-plugin/Source/.../Run/RunManager.h/cpp` - PIE/Standalone/Dedicated Server lifecycle

**Key implementation:**

- **Separate module**: Do NOT overload Build or LiveCoding modules with run logic
- Methods: run.playPIE, run.stopPIE, run.standalone, run.dedicatedServer (where applicable)
- Events: run.pieStatus, run.gameStarted, run.gameStopped
- Track PIE state in plugin runtime state
- **Game Thread Safety**: All PIE/run operations must execute on Game Thread
- Platform-specific: Dedicated server only on applicable platforms
- Status bar integration for PIE state

### Phase 4: Real-time Logging

**Files to create:**

- `cursor-extension/src/ui/webviews/logsView.ts` - Logs webview provider
- `cursor-extension/src/commands/logs.ts` - Log export commands
- `unreal-plugin/Source/.../Logs/LogCaptureDevice.h/cpp` - FOutputDevice implementation

**Key implementation:**

- Custom FOutputDevice registered with FOutputDeviceRedirector
- **Game Thread Safety**: Log capture device receives logs on game thread; emit events safely
- Subscription model: logs.subscribe/unsubscribe with filters
- Events: logs.line (timestamp, category, verbosity, message, file, line)
- Webview with pause/resume, filters, search
- **AI Observability**: `unreal.logs.exportJson` command for structured export
- Optional: Mirror Error/Warning to Problems panel

### Phase 5: UHT + IntelliSense

**Files to create:**

- `cursor-extension/src/commands/intellisense.ts` - IntelliSense commands
- `unreal-plugin/Source/.../Intellisense/IntellisenseGenerator.h/cpp` - UBT GenerateClangDatabase

**Key implementation:**

- Method: intellisense.generateCompileCommands
- UBT mode: GenerateClangDatabase
- Output to `.vscode/compile_commands.json` or `Saved/ClangDB/`
- Optional: uht.runCheck for UHT diagnostics
- Extension: Detect clangd, prompt configuration, workspace settings helper

### Phase 6: Blueprint + Asset CRUD

**Files to create:**

- `cursor-extension/src/commands/assets.ts` - Asset operation commands
- `cursor-extension/src/ui/webviews/blueprintView.ts` - Blueprint graph viewer
- `unreal-plugin/Source/.../Assets/AssetOperations.h/cpp` - AssetToolsModule wrapper

**Key implementation:**

- Methods: assets.list, assets.create, assets.rename, assets.delete, assets.openInEditor
- **Blueprint Safety Constraints (MANDATORY)**:
  - Restrict Blueprint modification to:
    - Default property changes (CDO)
    - Component add/remove
  - Prohibit arbitrary node rewiring or graph mutation in initial versions
  - All Blueprint edits MUST be wrapped in FScopedTransaction
  - Provide read-only Blueprint graph export first
  - Write support (blueprints.importGraphJson) gated behind feature flags
- Blueprint-specific: blueprints.create, blueprints.delete, blueprints.modify (safe ops only)
- **AI Observability**: `unreal.blueprints.exportGraphJson` command for structured export
- Transaction support (BeginTransaction/EndTransaction) for all asset operations
- **Game Thread Safety**: All asset operations MUST execute on Game Thread (marshaled from IPC)
- Tree view integration for assets
- Blueprint graph JSON export (read-only initially)

### Phase 7: Performance Profiling

**Files to create:**

- `cursor-extension/src/ui/webviews/profilingView.ts` - Profiling dashboard
- `cursor-extension/src/commands/profiling.ts` - Profiling commands (including export)
- `unreal-plugin/Source/.../Profiling/ProfilingManager.h/cpp` - Stats/Trace integration

**Key implementation:**

- Tier A: Console stat commands (stat unit, stat rhi, stat memory)
- Tier B: Unreal Insights/Trace framework integration
- **Unreal Insights Limitations**:
  - Some trace captures may require editor restart
  - Available trace channels vary by UE version
  - Gate Insights features behind capability checks (`capabilities.insights`)
- Methods: profiling.start, profiling.stop, profiling.snapshot, profiling.cancel(sessionId)
- Events: profiling.metrics, profiling.traceReady
- Webview dashboard with live charts, session controls, metrics table
- Session persistence
- Cancellation support for active profiling sessions
- **AI Observability**: `unreal.profiling.exportSession` command for structured export
- **Threading**: Stat collection runs on background thread; results marshaled to Game Thread

## Technical Decisions

1. **IPC Transport**: WebSocket (IWebSocket) from Unreal's WebSockets module, fallback to HTTP polling if needed
2. **Message Serialization**: JSON (FJsonObject in UE, native JSON in TS)
3. **Error Handling**: Structured error codes (e.g., "BUILD_IN_PROGRESS", "LIVE_CODING_DISABLED")
4. **State Management**: 

   - Protocol is stateless per request
   - Plugin runtime IS stateful and must track:
     - Active builds (with cancellation tokens)
     - Live Coding state
     - Log subscriptions
     - Profiling sessions
     - PIE/Standalone run state
   - Extension maintains connection state, build state, PIE state

5. **Threading & Game Thread Safety (CRITICAL)**:

   - All Unreal API (UObject, Editor, Asset, Blueprint) access MUST occur on the Game Thread
   - IPC receive callbacks MUST marshal work to Game Thread:
     ```cpp
     AsyncTask(ENamedThreads::GameThread, [this, ...]() {
       // Safe Unreal API access here
     });
     ```

   - Long-running operations (build, profiling, asset scans) MUST run on background threads
   - Results from background threads MUST be dispatched back to Game Thread before accessing Unreal APIs
   - WebSocket server receives on background thread but routes to Game Thread handlers

6. **Security**: Localhost-only binding, optional token authentication
7. **Cross-platform**: Detect OS in both extension and plugin, use appropriate UBT paths
8. **Operation Cancellation**: All long-running operations support cancellation tokens; cancellation state propagated through IPC

## Build Configuration

**Extension:**

- TypeScript 5.x
- Node.js 20+ (LTS)
- VS Code API 1.80+
- Webpack for bundling
- ESLint + Prettier

**UE Plugin:**

- UE 5.6+
- C++20 standard
- **Required Modules**: 
  - WebSockets (IPC server)
  - AssetTools (asset operations)
  - LiveCoding (live coding support)
  - UnrealEd (editor integration)
  - Slate, SlateCore (editor interactions and future dialogs)
- Editor-only (Type: Editor)

## Testing Strategy

- Extension: Unit tests for message parsing, state management, diagnostic conversion, capability checks
- Plugin: Self-test command validating IPC, log capture, asset listing, Game Thread marshaling
- Integration: Manual testing checklist per phase, including cancellation and capability negotiation

## AI Observability Requirement

**Mandatory for all UI-triggered commands and webview data:**

1. **Command Logging**: Every UI-triggered command MUST emit a structured command log entry (JSON):
   ```typescript
   {
     timestamp: string,
     command: string,
     params: any,
     result?: any,
     error?: any
   }
   ```

2. **Data Export**: All Webview-rendered data MUST be accessible via:

   - Commands returning JSON:
     - `unreal.logs.exportJson({ filters?, timeRange? })`
     - `unreal.profiling.exportSession({ sessionId })`
     - `unreal.blueprints.exportGraphJson({ objectPath })`
   - Export actions in webviews (e.g., "Export to JSON" button)

3. **Purpose**: Enable Cursor AI to analyze command history, logs, profiling data, and Blueprint graphs for debugging and optimization suggestions.

## Documentation Deliverables

1. **README.md** (root): Overview, quick start, architecture
2. **cursor-extension/README.md**: Extension installation, development setup
3. **unreal-plugin/README.md**: Plugin installation, compilation, troubleshooting
4. **API_CONTRACT.md**: Complete IPC method/event reference with schemas, including cancellation tokens and capability negotiation