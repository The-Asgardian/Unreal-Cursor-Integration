// Copyright Epic Games, Inc. All Rights Reserved.

#include "Run/RunManager.h"
#include "IPC/IPCServer.h"
#include "Dom/JsonObject.h"
#include "Editor.h"
#include "UnrealEdMisc.h"
#include "Editor/EditorEngine.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "PlayInEditorDataTypes.h"

RunManager::RunManager()
{
	bPIERunning = false;
	bStandaloneRunning = false;
	bDedicatedServerRunning = false;
}

RunManager::~RunManager()
{
}

RunManager& RunManager::Get()
{
	static RunManager Instance;
	return Instance;
}

bool RunManager::PlayInEditor()
{
	if (bPIERunning)
	{
		return false;
	}
	
	// Request PIE from editor
	FRequestPlaySessionParams Params;
	// Use default params for PIE (default is PIE)
	GEditor->RequestPlaySession(Params);
	
	bPIERunning = true;
	SendPIEStatusEvent();
	SendGameStartedEvent();
	
	return true;
}

void RunManager::StopPIE()
{
	if (!bPIERunning)
	{
		return;
	}
	
	// Request stop PIE
	GEditor->RequestEndPlayMap();
	
	bPIERunning = false;
	SendPIEStatusEvent();
	SendGameStoppedEvent();
}

bool RunManager::StartStandalone()
{
	if (bStandaloneRunning)
	{
		return false;
	}
	
	// Launch standalone game
	FRequestPlaySessionParams Params;
	Params.SessionDestination = EPlaySessionDestinationType::NewProcess;
	GEditor->RequestPlaySession(Params);
	
	bStandaloneRunning = true;
	SendGameStartedEvent();
	
	return true;
}

void RunManager::StopStandalone()
{
	if (!bStandaloneRunning)
	{
		return;
	}
	
	GEditor->RequestEndPlayMap();
	
	bStandaloneRunning = false;
	SendGameStoppedEvent();
}

bool RunManager::StartDedicatedServer()
{
	#if WITH_SERVER_CODE
	if (bDedicatedServerRunning)
	{
		return false;
	}
	
	// Launch dedicated server
	// Note: UE 5.6 doesn't have a direct dedicated server API via RequestPlaySession
	// This is a placeholder - dedicated server typically requires command line launch
	FRequestPlaySessionParams Params;
	Params.SessionDestination = EPlaySessionDestinationType::NewProcess;
	// TODO: Add dedicated server specific parameters when available
	GEditor->RequestPlaySession(Params);
	
	bDedicatedServerRunning = true;
	SendGameStartedEvent();
	
	return true;
	#else
	return false;
	#endif
}

void RunManager::StopDedicatedServer()
{
	if (!bDedicatedServerRunning)
	{
		return;
	}
	
	GEditor->RequestEndPlayMap();
	
	bDedicatedServerRunning = false;
	SendGameStoppedEvent();
}

void RunManager::SendPIEStatusEvent()
{
	TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
	EventData->SetBoolField(TEXT("running"), (bool)bPIERunning);
	IPCServer::Get().SendEvent(TEXT("run.pieStatus"), EventData);
}

void RunManager::SendGameStartedEvent()
{
	TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
	IPCServer::Get().SendEvent(TEXT("run.gameStarted"), EventData);
}

void RunManager::SendGameStoppedEvent()
{
	TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
	IPCServer::Get().SendEvent(TEXT("run.gameStopped"), EventData);
}
