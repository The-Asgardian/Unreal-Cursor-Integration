// Copyright Epic Games, Inc. All Rights Reserved.

#include "UnrealCursorBridge.h"
#include "IPC/IPCServer.h"
#include "IPC/MessageHandler.h"
#include "Logs/LogCaptureDevice.h"
#include "LiveCoding/LiveCodingManager.h"
#include "Modules/ModuleManager.h"

#define LOCTEXT_NAMESPACE "FUnrealCursorBridgeModule"

void FUnrealCursorBridgeModule::StartupModule()
{
	// Initialize log capture device (singleton)
	FLogCaptureDevice::Get();
	
	// Register message handlers
	MessageHandler::RegisterHandlers();
	
	// Enable Live Coding by default for plugin/extension iteration
	#if WITH_LIVE_CODING
	LiveCodingManager::Get().SetEnabled(true);
	#endif
	
	// Start IPC server after engine initialization
	IPCServer::Get().Start();
}

void FUnrealCursorBridgeModule::ShutdownModule()
{
	// Stop IPC server on shutdown
	IPCServer::Get().Stop();
}

#undef LOCTEXT_NAMESPACE
	
IMPLEMENT_MODULE(FUnrealCursorBridgeModule, UnrealCursorBridge)
