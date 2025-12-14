// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"

// Placeholder for Phase 3.5: Run Module
class RunManager
{
public:
	static RunManager& Get();
	
	void PlayPIE();
	void StopPIE();
	void RunStandalone();
	void RunDedicatedServer();
	
	bool IsPIERunning() const { return bPIERunning; }

private:
	RunManager() = default;
	~RunManager() = default;
	
	bool bPIERunning = false;
};

