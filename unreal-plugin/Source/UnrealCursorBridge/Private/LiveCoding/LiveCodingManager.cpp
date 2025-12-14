// Copyright Epic Games, Inc. All Rights Reserved.

#include "LiveCoding/LiveCodingManager.h"

LiveCodingManager& LiveCodingManager::Get()
{
	static LiveCodingManager Instance;
	return Instance;
}

bool LiveCodingManager::GetStatus(bool& OutEnabled, bool& OutCompiling, FString& OutLastResult)
{
	// Phase 3: Implement Live Coding status
	OutEnabled = this->bEnabled;
	OutCompiling = this->bCompiling;
	OutLastResult = this->LastResult;
	return IsAvailable();
}

void LiveCodingManager::Enable(bool bEnable)
{
	// Phase 3: Implement Live Coding enable/disable
	this->bEnabled = bEnable;
}

void LiveCodingManager::Compile()
{
	// Phase 3: Implement Live Coding compile
	this->bCompiling = true;
	// ... compile logic
	this->bCompiling = false;
}

void LiveCodingManager::Restart()
{
	// Phase 3: Implement Live Coding restart
}

bool LiveCodingManager::IsAvailable() const
{
	#if WITH_LIVE_CODING
	return true;
	#else
	return false;
	#endif
}

