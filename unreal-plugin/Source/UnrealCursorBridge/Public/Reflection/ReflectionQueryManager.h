// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "UObject/UObjectIterator.h"
#include "UObject/Class.h"
#include "UObject/UnrealType.h"
#include "Dom/JsonObject.h"
#include "Containers/Map.h"
#include "HAL/CriticalSection.h"
#include "HAL/PlatformFilemanager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Async/Async.h"
#include "HAL/ThreadSafeBool.h"

class ReflectionQueryManager
{
public:
	static ReflectionQueryManager& Get();
	
	// Initialize cache system (call on plugin startup)
	void InitializeCache();
	
	// Build cache asynchronously (multithreaded)
	void BuildCacheAsync();
	
	// Check if cache is ready
	bool IsCacheReady() const { return bCacheReady; }
	
	// Wait for cache to be ready (with timeout)
	bool WaitForCacheReady(float TimeoutSeconds = 30.0f);
	
	// List all loaded UClasses
	TArray<FString> ListClasses();
	
	// Get detailed class info with inheritance
	TSharedPtr<FJsonObject> GetClass(const FString& ClassName);
	
	// Get all functions for a class
	TArray<TSharedPtr<FJsonObject>> GetFunctions(const FString& ClassName);
	
	// Get all properties for a class
	TArray<TSharedPtr<FJsonObject>> GetProperties(const FString& ClassName);
	
	// Find symbol by name (class/function/property) - OPTIMIZED with cache
	TSharedPtr<FJsonObject> FindSymbol(const FString& SymbolName);
	
	// Get default values from CDO
	TSharedPtr<FJsonObject> GetCDODefaults(const FString& ClassName);

private:
	ReflectionQueryManager();
	~ReflectionQueryManager();
	
	// Helper functions
	TSharedPtr<FJsonObject> ClassToJson(UClass* Class);
	TSharedPtr<FJsonObject> FunctionToJson(UFunction* Function);
	TSharedPtr<FJsonObject> PropertyToJson(FProperty* Property);
	
	// Cache building
	void BuildCache();
	void BuildCacheForClass(UClass* Class);
	FString GetCacheFilePath() const;
	bool LoadCacheFromDisk();
	void SaveCacheToDisk();
	
	// Cache structures
	TMap<FString, TSharedPtr<FJsonObject>> ClassCache;
	TMap<FString, TSharedPtr<FJsonObject>> SymbolCache; // Fast lookup: symbol name -> symbol data
	TMap<FString, TArray<TSharedPtr<FJsonObject>>> ClassFunctionsCache; // Class name -> functions
	TMap<FString, TArray<TSharedPtr<FJsonObject>>> ClassPropertiesCache; // Class name -> properties
	
	mutable FCriticalSection CacheLock;
	FThreadSafeBool bCacheReady;
	FThreadSafeBool bCacheBuilding;
	
	// Invalidate cache on hot reload
	void InvalidateCache();
};

