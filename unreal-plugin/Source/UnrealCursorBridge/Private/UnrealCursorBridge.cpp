// Copyright Epic Games, Inc. All Rights Reserved.

#include "UnrealCursorBridge.h"
#include "IPC/IPCServer.h"
#include "IPC/MessageHandler.h"
#include "Modules/ModuleManager.h"

#define LOCTEXT_NAMESPACE "FUnrealCursorBridgeModule"

void FUnrealCursorBridgeModule::StartupModule()
{
	// Register message handlers
	MessageHandler::RegisterHandlers();
	
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
