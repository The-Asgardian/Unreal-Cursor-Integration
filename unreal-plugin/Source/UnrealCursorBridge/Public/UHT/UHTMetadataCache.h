// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "UHT/UHTMetadataExtractor.h"
#include "Dom/JsonObject.h"
#include "HAL/PlatformFilemanager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Containers/Map.h"
#include "HAL/CriticalSection.h"

class UHTMetadataCache
{
public:
	static UHTMetadataCache& Get();
	
	// Get cached metadata for a module, or extract if not cached
	TArray<FUHTClassMetadata> GetModuleMetadata(const FString& ModuleName, bool bForceRefresh = false);
	
	// Get cached metadata for a specific class
	bool GetClassMetadata(const FString& ModuleName, const FString& ClassName, FUHTClassMetadata& OutMetadata);
	
	// Invalidate cache for a module
	void InvalidateModule(const FString& ModuleName);
	
	// Clear all caches
	void ClearAll();
	
	// Save cache to disk
	bool SaveCache(const FString& ModuleName, const TArray<FUHTClassMetadata>& Metadata);
	
	// Load cache from disk
	bool LoadCache(const FString& ModuleName, TArray<FUHTClassMetadata>& OutMetadata);

private:
	UHTMetadataCache();
	~UHTMetadataCache();
	
	// Get cache file path for a module
	FString GetCacheFilePath(const FString& ModuleName) const;
	
	// Check if cache is valid (not stale)
	bool IsCacheValid(const FString& ModuleName) const;
	
	// In-memory cache
	TMap<FString, TArray<FUHTClassMetadata>> CachedMetadata;
	TMap<FString, double> CacheTimestamps;
	
	// Thread safety
	mutable FCriticalSection CacheLock;
	
	// Cache directory
	FString CacheDirectory;
};

