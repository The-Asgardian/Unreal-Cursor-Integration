// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "HAL/ThreadSafeBool.h"
#include "Engine/Engine.h"

class RunManager
{
public:
	static RunManager& Get();
	
	// Play In Editor
	bool PlayInEditor();
	void StopPIE();
	bool IsPIERunning() const { return bPIERunning; }
	
	// Standalone game
	bool StartStandalone();
	void StopStandalone();
	
	// Dedicated server (platform dependent)
	bool StartDedicatedServer();
	void StopDedicatedServer();

private:
	RunManager();
	~RunManager();
	
	FThreadSafeBool bPIERunning;
	FThreadSafeBool bStandaloneRunning;
	FThreadSafeBool bDedicatedServerRunning;
	
	void SendPIEStatusEvent();
	void SendGameStartedEvent();
	void SendGameStoppedEvent();
};
