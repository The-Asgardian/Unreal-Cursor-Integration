// Copyright Epic Games, Inc. All Rights Reserved.

#include "LiveCoding/LiveCodingManager.h"

LiveCodingManager& LiveCodingManager::Get()
{
	static LiveCodingManager Instance;
	return Instance;
}

bool LiveCodingManager::GetStatus(bool& bEnabled, bool& bCompiling, FString& LastResult)
{
	// Phase 3: Implement Live Coding status
	bEnabled = this->bEnabled;
	bCompiling = this->bCompiling;
	LastResult = this->LastResult;
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

