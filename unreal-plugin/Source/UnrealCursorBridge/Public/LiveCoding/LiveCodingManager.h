// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "HAL/ThreadSafeBool.h"

class LiveCodingManager
{
public:
	static LiveCodingManager& Get();
	
	// Get Live Coding status
	bool IsEnabled() const { return bEnabled; }
	bool IsCompiling() const { return bCompiling; }
	FString GetLastResult() const { return LastResult; }
	
	// Enable/disable Live Coding
	void SetEnabled(bool bInEnabled);
	
	// Trigger Live Coding compile
	bool Compile();
	
	// Restart Live Coding
	bool Restart();

private:
	LiveCodingManager();
	~LiveCodingManager();
	
	FThreadSafeBool bEnabled;
	FThreadSafeBool bCompiling;
	FString LastResult;
	
	void SendStatusChangedEvent();
};
