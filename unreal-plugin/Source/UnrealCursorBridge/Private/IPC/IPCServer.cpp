// Copyright Epic Games, Inc. All Rights Reserved.

#include "IPC/IPCServer.h"
#include "IWebSocketServer.h"
#include "INetworkingWebSocket.h"
#include "IWebSocketNetworkingModule.h"
#include "WebSocketNetworkingDelegates.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "HAL/RunnableThread.h"
#include "Misc/Guid.h"
#include "Templates/SharedPointer.h"

// Forward declaration for WebSocket connection wrapper
class FWebSocketConnection
{
public:
	FWebSocketConnection(INetworkingWebSocket* InSocket) : Socket(InSocket), MessageBuffer(MakeShareable(new FString())) {}
	INetworkingWebSocket* Socket;
	TSharedPtr<FString> MessageBuffer;
};

IPCServer::IPCServer()
	: bShouldStop(false)
	, bIsRunning(false)
	, WebSocketServer(nullptr)
	, Port(17777)
{
}

IPCServer::~IPCServer()
{
	Stop();
}

IPCServer& IPCServer::Get()
{
	static IPCServer Instance;
	return Instance;
}

void IPCServer::Start()
{
	if (bIsRunning)
	{
		return;
	}
	
	bShouldStop = false;
	FRunnableThread::Create(this, TEXT("IPCServerThread"));
}

void IPCServer::Stop()
{
	if (!bIsRunning)
	{
		return;
	}
	
	bShouldStop = true;
	
	if (WebSocketServer)
	{
		// Stop server
		delete WebSocketServer;
		WebSocketServer = nullptr;
	}
	
	// Wait for thread to finish
	while (bIsRunning)
	{
		FPlatformProcess::Sleep(0.1f);
	}
}

bool IPCServer::Init()
{
	IWebSocketNetworkingModule& WebSocketNetworkingModule = FModuleManager::LoadModuleChecked<IWebSocketNetworkingModule>(TEXT("WebSocketNetworking"));
	
	// Create WebSocket server
	TUniquePtr<IWebSocketServer> Server = WebSocketNetworkingModule.CreateServer();
	WebSocketServer = Server.Release();
	
	if (!WebSocketServer)
	{
		UE_LOG(LogTemp, Error, TEXT("Failed to create WebSocket server"));
		return false;
	}
	
	// Bind to localhost only
	FString BindAddress = TEXT("127.0.0.1");
	
	// Define the client connected callback
	FWebSocketClientConnectedCallBack ClientConnectedCallback = FWebSocketClientConnectedCallBack::CreateLambda(
		[this](INetworkingWebSocket* NewClient)
		{
			UE_LOG(LogTemp, Log, TEXT("New WebSocket client connected"));
			
			// Add to connected clients list
			{
				FScopeLock Lock(&ClientsLock);
				ConnectedClients.Add(NewClient);
			}
			
			// Create connection wrapper with message buffer
			TSharedPtr<FWebSocketConnection> Connection = MakeShareable(new FWebSocketConnection(NewClient));
			
			// Store connection in clients map for later use
			{
				FScopeLock Lock(&ClientsLock);
				// Note: We'll use the connection's message buffer
			}
			
			// Set up message handling for the client
			NewClient->SetReceiveCallBack(FWebSocketPacketReceivedCallBack::CreateLambda(
				[this, Connection](void* Data, int32 Size)
				{
					// Convert received data to FString
					FString ReceivedChunk = FString(UTF8_TO_TCHAR(static_cast<const char*>(Data)));
					
					// Append to connection's buffer
					*Connection->MessageBuffer += ReceivedChunk;
					
					// Try to parse complete JSON messages
					// Look for complete JSON objects (balanced braces)
					FString Remaining = *Connection->MessageBuffer;
					
					while (!Remaining.IsEmpty())
					{
						int32 OpenBraces = 0;
						int32 StartPos = 0;
						int32 EndPos = -1;
						
						// Find the start of a JSON object
						for (int32 i = 0; i < Remaining.Len(); i++)
						{
							if (Remaining[i] == TEXT('{'))
							{
								if (OpenBraces == 0)
								{
									StartPos = i;
								}
								OpenBraces++;
							}
							else if (Remaining[i] == TEXT('}'))
							{
								OpenBraces--;
								if (OpenBraces == 0)
								{
									EndPos = i;
									break;
								}
							}
						}
						
						if (EndPos >= 0)
						{
							// Extract complete message
							FString CompleteMessage = Remaining.Mid(StartPos, EndPos - StartPos + 1);
							Remaining = Remaining.Mid(EndPos + 1);
							
							ProcessMessage(CompleteMessage, Connection.Get());
						}
						else
						{
							// No complete message found, keep buffer
							break;
						}
					}
					
					// Update buffer with remaining data
					*Connection->MessageBuffer = Remaining;
				}
			));
			
			// Note: WebSocket disconnect handling will be done when connection is detected as closed
			// For now, we'll handle it in the message processing or via periodic cleanup
		}
	);
	
	// Start server
	if (!WebSocketServer->Init(Port, ClientConnectedCallback, BindAddress))
	{
		UE_LOG(LogTemp, Error, TEXT("Failed to start WebSocket server on port %d"), Port);
		return false;
	}
	
	UE_LOG(LogTemp, Log, TEXT("IPC Server started on %s:%d"), *BindAddress, Port);
	
	bIsRunning = true;
	return true;
}

uint32 IPCServer::Run()
{
	if (!WebSocketServer)
	{
		return 1;
	}
	
	// Main loop - tick the server to process connections and messages
	while (!bShouldStop)
	{
		if (WebSocketServer)
		{
			WebSocketServer->Tick();
		}
		FPlatformProcess::Sleep(0.01f);
	}
	
	return 0;
}

void IPCServer::Exit()
{
	bIsRunning = false;
	
	if (WebSocketServer)
	{
		delete WebSocketServer;
		WebSocketServer = nullptr;
	}
	
	UE_LOG(LogTemp, Log, TEXT("IPC Server stopped"));
}

void IPCServer::ProcessMessage(const FString& Message, FWebSocketConnection* Connection)
{
	TSharedPtr<FJsonObject> JsonObject;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Message);
	
	if (!FJsonSerializer::Deserialize(Reader, JsonObject) || !JsonObject.IsValid())
	{
		UE_LOG(LogTemp, Warning, TEXT("Failed to parse IPC message: %s"), *Message);
		return;
	}
	
	FString Type;
	if (!JsonObject->TryGetStringField(TEXT("type"), Type))
	{
		UE_LOG(LogTemp, Warning, TEXT("IPC message missing type field"));
		return;
	}
	
	if (Type == TEXT("request"))
	{
		FIPCRequestMessage Request;
		if (Request.FromJson(JsonObject))
		{
			// Store connection for response (simplified - in production, use connection map)
			// Marshal to game thread for Unreal API access
			AsyncTask(ENamedThreads::GameThread, [this, Request, Connection]()
			{
				HandleRequest(Request, Connection);
			});
		}
	}
}

void IPCServer::HandleRequest(const FIPCRequestMessage& Request, FWebSocketConnection* Connection)
{
	// Store connection for this request
	{
		FScopeLock Lock(&PendingRequestsLock);
		PendingRequests.Add(Request.Id, Connection->Socket);
	}
	
	FScopeLock Lock(&HandlersLock);
	
	FIPCRequestHandler* Handler = RequestHandlers.Find(Request.Method);
	if (Handler)
	{
		Handler->ExecuteIfBound(Request);
	}
	else
	{
		UE_LOG(LogTemp, Warning, TEXT("No handler for method: %s"), *Request.Method);
		SendError(Request.Id, TEXT("METHOD_NOT_FOUND"), FString::Printf(TEXT("Method not found: %s"), *Request.Method), Connection->Socket);
	}
}

void IPCServer::SendResponse(const FString& RequestId, const TSharedPtr<FJsonObject>& Result, INetworkingWebSocket* Connection)
{
	// If connection not provided, try to find it from pending requests
	INetworkingWebSocket* TargetConnection = Connection;
	if (!TargetConnection)
	{
		FScopeLock Lock(&PendingRequestsLock);
		INetworkingWebSocket** FoundConnection = PendingRequests.Find(RequestId);
		if (FoundConnection)
		{
			TargetConnection = *FoundConnection;
			// Remove from map after use
			PendingRequests.Remove(RequestId);
		}
	}
	else
	{
		// Remove from map if we have the connection
		FScopeLock Lock(&PendingRequestsLock);
		PendingRequests.Remove(RequestId);
	}
	
	if (!TargetConnection)
	{
		UE_LOG(LogTemp, Error, TEXT("Cannot send response: Connection is null for request ID: %s"), *RequestId);
		return;
	}
	
	FIPCResponseMessage Response;
	Response.Id = RequestId;
	Response.Type = TEXT("response");
	Response.Result = Result;
	
	TSharedPtr<FJsonObject> JsonObject = Response.ToJson();
	FString OutputString;
	TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutputString);
	FJsonSerializer::Serialize(JsonObject.ToSharedRef(), Writer);
	
	// Don't log responses to prevent infinite recursion with log capture
	// UE_LOG(LogTemp, Log, TEXT("Sending response: %s"), *OutputString);
	
	// Send via WebSocket
	FTCHARToUTF8 UTF8String(*OutputString);
	TargetConnection->Send((uint8*)UTF8String.Get(), UTF8String.Length(), false);
}

void IPCServer::SendError(const FString& RequestId, const FString& ErrorCode, const FString& ErrorMessage, INetworkingWebSocket* Connection, const TSharedPtr<FJsonObject>& ErrorData)
{
	if (!Connection)
	{
		UE_LOG(LogTemp, Error, TEXT("Cannot send error: Connection is null"));
		return;
	}
	
	FIPCResponseMessage Response;
	Response.Id = RequestId;
	Response.Type = TEXT("response");
	
	FIPCResponseMessage::FError Error;
	Error.Code = ErrorCode;
	Error.Message = ErrorMessage;
	Error.Data = ErrorData;
	Response.Error = Error;
	
	TSharedPtr<FJsonObject> JsonObject = Response.ToJson();
	FString OutputString;
	TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutputString);
	FJsonSerializer::Serialize(JsonObject.ToSharedRef(), Writer);
	
	UE_LOG(LogTemp, Log, TEXT("Sending error: %s"), *OutputString);
	
	// Send via WebSocket
	FTCHARToUTF8 UTF8String(*OutputString);
	Connection->Send((uint8*)UTF8String.Get(), UTF8String.Length(), false);
}

void IPCServer::SendEvent(const FString& EventName, const TSharedPtr<FJsonObject>& EventData)
{
	FIPCEventMessage Event;
	Event.Id = FGuid::NewGuid().ToString();
	Event.Type = TEXT("event");
	Event.Event = EventName;
	Event.Data = EventData;
	
	TSharedPtr<FJsonObject> JsonObject = Event.ToJson();
	FString OutputString;
	TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutputString);
	FJsonSerializer::Serialize(JsonObject.ToSharedRef(), Writer);
	
	// Broadcast event to all connected clients
	FTCHARToUTF8 UTF8String(*OutputString);
	FScopeLock Lock(&ClientsLock);
	int32 ClientsSent = 0;
	for (INetworkingWebSocket* Client : ConnectedClients)
	{
		if (Client)
		{
			Client->Send((uint8*)UTF8String.Get(), UTF8String.Length(), false);
			ClientsSent++;
		}
	}
	
	// Log cache events for debugging (but not all events to prevent log spam)
	if (EventName.StartsWith(TEXT("reflection.cache")))
	{
		UE_LOG(LogTemp, Log, TEXT("[IPCServer] Event %s sent to %d/%d clients"), *EventName, ClientsSent, ConnectedClients.Num());
	}
}

void IPCServer::RegisterHandler(const FString& Method, FIPCRequestHandler Handler)
{
	FScopeLock Lock(&HandlersLock);
	RequestHandlers.Add(Method, Handler);
}

