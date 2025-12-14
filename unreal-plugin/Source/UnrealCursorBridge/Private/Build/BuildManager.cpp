// Copyright Epic Games, Inc. All Rights Reserved.

#include "Build/BuildManager.h"

BuildManager& BuildManager::Get()
{
	static BuildManager Instance;
	return Instance;
}

void BuildManager::StartBuild(const FString& Target, const FString& Configuration, const FString& Platform, const FString& ProjectPath, const TArray<FString>& ExtraArgs)
{
	// Phase 2: Implement UBT invocation
	// This will be implemented in Phase 2
}

void BuildManager::CancelBuild(const FString& BuildId)
{
	// Phase 2: Implement build cancellation
	// This will be implemented in Phase 2
}

