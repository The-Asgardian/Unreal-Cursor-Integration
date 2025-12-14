import WebSocket from 'ws';
import { Message, RequestMessage, ResponseMessage, EventMessage } from './protocol';
import { v4 as uuidv4 } from 'uuid';

export type MessageHandler = (message: Message) => void;
export type EventHandler = (event: string, data: any) => void;

export class IPCClient {
    private ws: WebSocket | undefined;
    private url: string;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 10;
    private reconnectDelay: number = 1000;
    private pendingRequests: Map<string, {
        resolve: (value: ResponseMessage) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    }> = new Map();
    private eventHandlers: Map<string, EventHandler[]> = new Map();
    private messageHandlers: MessageHandler[] = [];
    private shouldReconnect: boolean = false;
    private connectionTimeout: number = 5000;

    constructor(url: string) {
        this.url = url;
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                resolve();
                return;
            }

            this.shouldReconnect = true;
            const ws = new WebSocket(this.url);
            this.ws = ws;

            const timeout = setTimeout(() => {
                if (ws.readyState !== WebSocket.OPEN) {
                    ws.close();
                    reject(new Error('Connection timeout'));
                }
            }, this.connectionTimeout);

            ws.on('open', () => {
                clearTimeout(timeout);
                this.reconnectAttempts = 0;
                resolve();
            });

            ws.on('error', (error: Error) => {
                clearTimeout(timeout);
                reject(error);
            });

            ws.on('message', (data: WebSocket.Data) => {
                try {
                    const rawMessage = data.toString();
                    // Only log in debug mode to prevent log spam
                    // console.log('[IPC Client] Received message:', rawMessage);
                    const message: Message = JSON.parse(rawMessage);
                    this.handleMessage(message);
                } catch (error) {
                    // Only log parse errors, not every message
                    console.error('[IPC Client] Failed to parse message:', error);
                }
            });

            ws.on('close', () => {
                this.handleDisconnect();
            });
        });
    }

    disconnect(): void {
        this.shouldReconnect = false;
        this.ws?.close();
        this.ws = undefined;
        
        // Reject all pending requests
        for (const [id, { reject, timeout }] of this.pendingRequests) {
            clearTimeout(timeout);
            reject(new Error('Connection closed'));
        }
        this.pendingRequests.clear();
    }

    sendRequest(method: string, params: Record<string, any>, cancelToken?: string, timeout: number = 30000): Promise<ResponseMessage> {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('Not connected'));
                return;
            }

            const id = uuidv4();
            const request: RequestMessage = {
                id,
                type: 'request',
                method,
                params,
                cancelToken
            };

            const timeoutHandle = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Request timeout: ${method}`));
            }, timeout);

            this.pendingRequests.set(id, {
                resolve,
                reject,
                timeout: timeoutHandle
            });

            try {
                const requestJson = JSON.stringify(request);
                // Only log in debug mode to prevent log spam
                // console.log('[IPC Client] Sending request:', requestJson);
                this.ws.send(requestJson);
            } catch (error) {
                this.pendingRequests.delete(id);
                clearTimeout(timeoutHandle);
                reject(error);
            }
        });
    }

    onEvent(event: string, handler: EventHandler): void {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event)!.push(handler);
    }

    offEvent(event: string, handler: EventHandler): void {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index >= 0) {
                handlers.splice(index, 1);
            }
        }
    }

    onMessage(handler: MessageHandler): void {
        this.messageHandlers.push(handler);
    }

    offMessage(handler: MessageHandler): void {
        const index = this.messageHandlers.indexOf(handler);
        if (index >= 0) {
            this.messageHandlers.splice(index, 1);
        }
    }

    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    private handleMessage(message: Message): void {
        // Only log in debug mode to prevent log spam
        // console.log('[IPC Client] Handling message:', JSON.stringify(message));
        
        // Notify all message handlers
        for (const handler of this.messageHandlers) {
            handler(message);
        }

        if (message.type === 'response') {
            const response = message as ResponseMessage;
            // Only log errors, not every response
            const pending = this.pendingRequests.get(response.id);
            if (pending) {
                clearTimeout(pending.timeout);
                this.pendingRequests.delete(response.id);
                pending.resolve(response);
            } else {
                // Only log if it's unexpected (no pending request)
                console.warn('[IPC Client] No pending request found for response ID:', response.id);
            }
        } else if (message.type === 'event') {
            const event = message as EventMessage;
            const handlers = this.eventHandlers.get(event.event);
            if (handlers) {
                for (const handler of handlers) {
                    handler(event.event, event.data);
                }
            }
        }
    }

    private handleDisconnect(): void {
        // Reject all pending requests
        for (const [id, { reject, timeout }] of this.pendingRequests) {
            clearTimeout(timeout);
            reject(new Error('Connection closed'));
        }
        this.pendingRequests.clear();

        // Attempt reconnection if needed
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
            
            setTimeout(() => {
                if (this.shouldReconnect) {
                    this.connect().catch((error) => {
                        console.error('Reconnection failed:', error);
                    });
                }
            }, delay);
        }
    }
}

