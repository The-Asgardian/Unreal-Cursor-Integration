// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"

// Placeholder for Phase 3: Live Coding
class LiveCodingManager
{
public:
	static LiveCodingManager& Get();
	
	bool GetStatus(bool& OutEnabled, bool& OutCompiling, FString& OutLastResult);
	void Enable(bool bEnable);
	void Compile();
	void Restart();
	
	bool IsAvailable() const;

private:
	LiveCodingManager() = default;
	~LiveCodingManager() = default;
	
	bool bEnabled = false;
	bool bCompiling = false;
	FString LastResult;
};

