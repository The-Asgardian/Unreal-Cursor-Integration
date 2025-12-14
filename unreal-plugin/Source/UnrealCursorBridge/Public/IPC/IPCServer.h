// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "HAL/Runnable.h"
#include "HAL/ThreadSafeBool.h"
#include "Containers/Queue.h"
#include "Containers/Map.h"
#include "IPC/IPCProtocol.h"

class FWebSocketServer;
class FWebSocketConnection;

DECLARE_DELEGATE_OneParam(FIPCRequestHandler, const FIPCRequestMessage&);

class IPCServer : public FRunnable
{
public:
	static IPCServer& Get();
	
	void Start();
	void Stop();
	
	void SendResponse(const FString& RequestId, const TSharedPtr<FJsonObject>& Result);
	void SendError(const FString& RequestId, const FString& ErrorCode, const FString& ErrorMessage, const TSharedPtr<FJsonObject>& ErrorData = nullptr);
	void SendEvent(const FString& EventName, const TSharedPtr<FJsonObject>& EventData);
	
	void RegisterHandler(const FString& Method, FIPCRequestHandler Handler);
	
	// FRunnable interface
	virtual bool Init() override;
	virtual uint32 Run() override;
	virtual void Stop() override;
	virtual void Exit() override;

private:
	IPCServer();
	~IPCServer();
	
	void ProcessMessage(const FString& Message, FWebSocketConnection* Connection);
	void HandleRequest(const FIPCRequestMessage& Request, FWebSocketConnection* Connection);
	
	FThreadSafeBool bShouldStop;
	FThreadSafeBool bIsRunning;
	
	TMap<FString, FIPCRequestHandler> RequestHandlers;
	
	FWebSocketServer* WebSocketServer;
	int32 Port;
	
	FCriticalSection HandlersLock;
};

