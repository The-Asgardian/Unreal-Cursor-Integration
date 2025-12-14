// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"

// Placeholder for Phase 7: Performance Profiling
class ProfilingManager
{
public:
	static ProfilingManager& Get();
	
	FString StartProfiling(const FString& Mode, int32 IntervalMs, const TArray<FString>& Channels);
	void StopProfiling();
	void CancelProfiling(const FString& SessionId);
	TSharedPtr<FJsonObject> GetSnapshot();
	TSharedPtr<FJsonObject> ExportSession(const FString& SessionId);
	
	bool IsProfilingActive() const { return bProfilingActive; }

private:
	ProfilingManager() = default;
	~ProfilingManager() = default;
	
	bool bProfilingActive = false;
	FString CurrentSessionId;
};

