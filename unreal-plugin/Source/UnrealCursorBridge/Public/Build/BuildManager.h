// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "HAL/Runnable.h"
#include "HAL/ThreadSafeBool.h"

// Placeholder for Phase 2: Build System
class BuildManager
{
public:
	static BuildManager& Get();
	
	void StartBuild(const FString& Target, const FString& Configuration, const FString& Platform, const FString& ProjectPath, const TArray<FString>& ExtraArgs);
	void CancelBuild(const FString& BuildId);
	
	bool IsBuildInProgress() const { return bBuildInProgress; }

private:
	BuildManager() = default;
	~BuildManager() = default;
	
	FThreadSafeBool bBuildInProgress;
	FString CurrentBuildId;
};

