// Copyright Epic Games, Inc. All Rights Reserved.

#include "LiveCoding/LiveCodingManager.h"
#include "IPC/IPCServer.h"
#include "Dom/JsonObject.h"
#include "Modules/ModuleManager.h"

#if WITH_LIVE_CODING
#include "ILiveCodingModule.h"
#endif

LiveCodingManager::LiveCodingManager()
	: bEnabled(false)
	, bCompiling(false)
	, LastResult(TEXT("none"))
{
}

LiveCodingManager::~LiveCodingManager()
{
}

LiveCodingManager& LiveCodingManager::Get()
{
	static LiveCodingManager Instance;
	return Instance;
}

void LiveCodingManager::SetEnabled(bool bInEnabled)
{
	bEnabled = bInEnabled;
	SendStatusChangedEvent();
}

bool LiveCodingManager::Compile()
{
	#if WITH_LIVE_CODING
	if (bCompiling)
	{
		return false;
	}
	
	ILiveCodingModule* LiveCoding = FModuleManager::GetModulePtr<ILiveCodingModule>(TEXT("LiveCoding"));
	if (!LiveCoding)
	{
		LastResult = TEXT("unavailable");
		return false;
	}
	
	bCompiling = true;
	SendStatusChangedEvent();
	
	// Trigger Live Coding compile
	LiveCoding->Compile();
	
	bCompiling = false;
	LastResult = TEXT("success");
	SendStatusChangedEvent();
	
	return true;
	#else
	LastResult = TEXT("unsupported");
	return false;
	#endif
}

bool LiveCodingManager::Restart()
{
	#if WITH_LIVE_CODING
	ILiveCodingModule* LiveCoding = FModuleManager::GetModulePtr<ILiveCodingModule>(TEXT("LiveCoding"));
	if (!LiveCoding)
	{
		return false;
	}
	
	// RestartTargets() was removed in UE 5.6, use Compile() instead
	LiveCoding->Compile();
	return true;
	#else
	return false;
	#endif
}

void LiveCodingManager::SendStatusChangedEvent()
{
	TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
	EventData->SetBoolField(TEXT("enabled"), (bool)bEnabled);
	EventData->SetBoolField(TEXT("compiling"), (bool)bCompiling);
	IPCServer::Get().SendEvent(TEXT("livecoding.statusChanged"), EventData);
}
