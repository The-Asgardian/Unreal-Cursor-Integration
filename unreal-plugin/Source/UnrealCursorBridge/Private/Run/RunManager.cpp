// Copyright Epic Games, Inc. All Rights Reserved.

#include "Run/RunManager.h"

RunManager& RunManager::Get()
{
	static RunManager Instance;
	return Instance;
}

void RunManager::PlayPIE()
{
	// Phase 3.5: Implement PIE start
	bPIERunning = true;
}

void RunManager::StopPIE()
{
	// Phase 3.5: Implement PIE stop
	bPIERunning = false;
}

void RunManager::RunStandalone()
{
	// Phase 3.5: Implement standalone game
}

void RunManager::RunDedicatedServer()
{
	// Phase 3.5: Implement dedicated server
}

