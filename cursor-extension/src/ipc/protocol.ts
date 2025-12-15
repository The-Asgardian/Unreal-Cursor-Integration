export interface BaseMessage {
    id: string;
    type: 'request' | 'response' | 'event';
}

export interface RequestMessage extends BaseMessage {
    type: 'request';
    method: string;
    params: Record<string, any>;
    cancelToken?: string;
}

export interface ResponseMessage extends BaseMessage {
    type: 'response';
    result?: any;
    error?: {
        code: string;
        message: string;
        data?: any;
    };
}

export interface EventMessage extends BaseMessage {
    type: 'event';
    event: string;
    data: any;
}

export type Message = RequestMessage | ResponseMessage | EventMessage;

// Request/Response method types
export type Method = 
    | 'client.hello'
    | 'ping'
    | 'status.get'
    | 'project.info'
    | 'build.start'
    | 'build.cancel'
    | 'build.listTargets'
    | 'livecoding.status'
    | 'livecoding.enable'
    | 'livecoding.compile'
    | 'livecoding.restart'
    | 'run.playPIE'
    | 'run.stopPIE'
    | 'run.standalone'
    | 'run.dedicatedServer'
    | 'logs.subscribe'
    | 'logs.unsubscribe'
    | 'logs.export'
    | 'profiling.start'
    | 'profiling.stop'
    | 'profiling.cancel'
    | 'profiling.snapshot'
    | 'profiling.exportSession'
    | 'intellisense.generateCompileCommands'
    | 'uht.runCheck'
    | 'uht.runAndCollect'
    | 'uht.getReflectionSummary'
    | 'uht.getClassMetadata'
    | 'uht.getFunctionMetadata'
    | 'uht.getPropertyMetadata'
    | 'reflection.listClasses'
    | 'reflection.getClass'
    | 'reflection.getFunctions'
    | 'reflection.getProperties'
    | 'reflection.findSymbol'
    | 'reflection.getCDODefaults'
    | 'reflection.getUsageData'
    | 'unreal.reflection.exportJson'
    | 'unreal.uht.exportJson'
    | 'unreal.intellisense.exportContext'
    | 'assets.list'
    | 'assets.create'
    | 'assets.rename'
    | 'assets.delete'
    | 'assets.openInEditor'
    | 'blueprints.create'
    | 'blueprints.delete'
    | 'blueprints.modify'
    | 'blueprints.exportGraphJson';

// Event types
export type EventType =
    | 'logs.line'
    | 'build.progress'
    | 'build.outputLine'
    | 'build.diagnostic'
    | 'build.finished'
    | 'livecoding.statusChanged'
    | 'livecoding.outputLine'
    | 'run.pieStatus'
    | 'run.gameStarted'
    | 'run.gameStopped'
    | 'profiling.metrics'
    | 'profiling.traceReady'
    | 'intellisense.compileCommandsGenerated'
    | 'uht.diagnostic';

// Client hello request
export interface ClientHelloRequest {
    workspacePath: string;
    extensionVersion: string;
    clientInfo: {
        platform: string;
        vscodeVersion: string;
    };
}

// Client hello response
export interface ClientHelloResponse {
    engineVersion: string;
    projectName: string;
    projectPath: string;
    supportedPlatforms: string[];
    capabilities: {
        liveCoding: boolean;
        insights: boolean;
        assetEditing: boolean;
        blueprintEditing: boolean;
    };
}

// Build request
export interface BuildStartRequest {
    target: string;
    configuration: string;
    platform: string;
    projectPath: string;
    extraArgs?: string[];
}

// Logs subscribe request
export interface LogsSubscribeRequest {
    categories?: string[];
    verbosity?: string;
    search?: string;
}

// Profiling start request
export interface ProfilingStartRequest {
    mode: 'stats' | 'trace';
    intervalMs?: number;
    channels?: string[];
}

