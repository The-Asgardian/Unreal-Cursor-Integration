// Copyright Epic Games, Inc. All Rights Reserved.

#include "IPC/IPCServer.h"
#include "IWebSocketServer.h"
#include "IWebSocket.h"
#include "WebSocketsModule.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonSerializer.h"
#include "HAL/RunnableThread.h"
#include "Misc/Guid.h"

// Forward declaration for WebSocket connection wrapper
class FWebSocketConnection
{
public:
	FWebSocketConnection(TSharedPtr<IWebSocket> InSocket) : Socket(InSocket) {}
	TSharedPtr<IWebSocket> Socket;
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
	FWebSocketsModule& WebSocketsModule = FModuleManager::LoadModuleChecked<FWebSocketsModule>(TEXT("WebSockets"));
	
	// Create WebSocket server
	WebSocketServer = WebSocketsModule.CreateServer();
	
	if (!WebSocketServer)
	{
		UE_LOG(LogTemp, Error, TEXT("Failed to create WebSocket server"));
		return false;
	}
	
	// Bind to localhost only
	FString BindAddress = TEXT("127.0.0.1");
	
	// Start server
	if (!WebSocketServer->Init(Port, BindAddress))
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
	
	// Set up connection handler
	WebSocketServer->OnConnection().AddLambda([this](TSharedPtr<IWebSocket> Socket)
	{
		UE_LOG(LogTemp, Log, TEXT("New WebSocket connection"));
		
		Socket->OnMessage().AddLambda([this, Socket](const FString& Message)
		{
			FWebSocketConnection Connection(Socket);
			ProcessMessage(Message, &Connection);
		});
		
		Socket->OnClosed().AddLambda([](int32 StatusCode, const FString& Reason, bool bWasClean)
		{
			UE_LOG(LogTemp, Log, TEXT("WebSocket connection closed: %s"), *Reason);
		});
		
		Socket->OnError().AddLambda([](const FString& Error)
		{
			UE_LOG(LogTemp, Error, TEXT("WebSocket error: %s"), *Error);
		});
	});
	
	// Main loop
	while (!bShouldStop)
	{
		FPlatformProcess::Sleep(0.1f);
	}
	
	return 0;
}

void IPCServer::Stop()
{
	bShouldStop = true;
}

void IPCServer::Exit()
{
	bIsRunning = false;
	
	if (WebSocketServer)
	{
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
	FScopeLock Lock(&HandlersLock);
	
	FIPCRequestHandler* Handler = RequestHandlers.Find(Request.Method);
	if (Handler)
	{
		Handler->ExecuteIfBound(Request);
	}
	else
	{
		UE_LOG(LogTemp, Warning, TEXT("No handler for method: %s"), *Request.Method);
		SendError(Request.Id, TEXT("METHOD_NOT_FOUND"), FString::Printf(TEXT("Method not found: %s"), *Request.Method));
	}
}

void IPCServer::SendResponse(const FString& RequestId, const TSharedPtr<FJsonObject>& Result)
{
	FIPCResponseMessage Response;
	Response.Id = RequestId;
	Response.Type = TEXT("response");
	Response.Result = Result;
	
	TSharedPtr<FJsonObject> JsonObject = Response.ToJson();
	FString OutputString;
	TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutputString);
	FJsonSerializer::Serialize(JsonObject.ToSharedRef(), Writer);
	
	// NOTE: This is a simplified implementation. In production, we need to:
	// 1. Track active connections in a map
	// 2. Store connection reference with each request
	// 3. Send response to the specific connection that made the request
	// For now, we log the response - the actual WebSocket send will be implemented
	// when we have proper connection tracking
	UE_LOG(LogTemp, Log, TEXT("Sending response: %s"), *OutputString);
	
	// TODO: Send via WebSocket to the connection that made the request
	// Connection->Socket->Send(OutputString);
}

void IPCServer::SendError(const FString& RequestId, const FString& ErrorCode, const FString& ErrorMessage, const TSharedPtr<FJsonObject>& ErrorData)
{
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
	
	// TODO: Send via WebSocket to the connection that made the request
	// Connection->Socket->Send(OutputString);
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
	
	UE_LOG(LogTemp, Log, TEXT("Sending event: %s"), *OutputString);
	
	// TODO: Broadcast event to all connected clients
	// For each connection in connections map:
	//   Connection->Socket->Send(OutputString);
}

void IPCServer::RegisterHandler(const FString& Method, FIPCRequestHandler Handler)
{
	FScopeLock Lock(&HandlersLock);
	RequestHandlers.Add(Method, Handler);
}

