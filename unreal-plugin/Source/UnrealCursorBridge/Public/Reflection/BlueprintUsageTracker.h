// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Engine/Blueprint.h"
#include "Dom/JsonObject.h"
#include "Containers/Map.h"
#include "HAL/CriticalSection.h"

struct FBlueprintUsageInfo
{
	TArray<FString> UsedInBlueprints;
	TArray<FString> OverriddenInBlueprints;
	int32 UsageCount;
};

class BlueprintUsageTracker
{
public:
	static BlueprintUsageTracker& Get();
	
	// Scan all Blueprints and build usage index
	void ScanBlueprints();
	
	// Get usage data for a symbol (function or property)
	FBlueprintUsageInfo GetUsageData(const FString& SymbolName, const FString& ClassName);
	
	// Get all usage data
	TMap<FString, FBlueprintUsageInfo> GetAllUsageData();
	
	// Invalidate cache
	void InvalidateCache();

private:
	BlueprintUsageTracker();
	~BlueprintUsageTracker();
	
	// Build reverse index: ClassName::SymbolName -> List of Blueprints
	TMap<FString, FBlueprintUsageInfo> UsageIndex;
	
	// Thread safety
	mutable FCriticalSection UsageIndexLock;
	
	// Cache timestamp
	double LastScanTime;
	
	// Check if cache is stale (older than 5 minutes)
	bool IsCacheStale() const;
	
	// Extract function calls and property accesses from a Blueprint
	void ExtractBlueprintUsage(UBlueprint* Blueprint, const FString& BlueprintPath);
};

