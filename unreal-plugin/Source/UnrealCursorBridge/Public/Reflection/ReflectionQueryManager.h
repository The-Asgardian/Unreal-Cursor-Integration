// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "UObject/UObjectIterator.h"
#include "UObject/Class.h"
#include "UObject/UnrealType.h"
#include "Dom/JsonObject.h"
#include "Containers/Map.h"
#include "HAL/CriticalSection.h"

class ReflectionQueryManager
{
public:
	static ReflectionQueryManager& Get();
	
	// List all loaded UClasses
	TArray<FString> ListClasses();
	
	// Get detailed class info with inheritance
	TSharedPtr<FJsonObject> GetClass(const FString& ClassName);
	
	// Get all functions for a class
	TArray<TSharedPtr<FJsonObject>> GetFunctions(const FString& ClassName);
	
	// Get all properties for a class
	TArray<TSharedPtr<FJsonObject>> GetProperties(const FString& ClassName);
	
	// Find symbol by name (class/function/property)
	TSharedPtr<FJsonObject> FindSymbol(const FString& SymbolName);
	
	// Get default values from CDO
	TSharedPtr<FJsonObject> GetCDODefaults(const FString& ClassName);

private:
	ReflectionQueryManager() = default;
	~ReflectionQueryManager() = default;
	
	// Helper functions
	TSharedPtr<FJsonObject> ClassToJson(UClass* Class);
	TSharedPtr<FJsonObject> FunctionToJson(UFunction* Function);
	TSharedPtr<FJsonObject> PropertyToJson(FProperty* Property);
	
	// Cache
	TMap<FString, TSharedPtr<FJsonObject>> ClassCache;
	mutable FCriticalSection CacheLock;
	
	// Invalidate cache on hot reload
	void InvalidateCache();
};

