// Copyright Epic Games, Inc. All Rights Reserved.

#include "Reflection/BlueprintUsageTracker.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "Engine/Blueprint.h"
#include "Engine/BlueprintGeneratedClass.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "UObject/UObjectGlobals.h"
#include "UObject/UnrealType.h"
#include "UObject/PropertyPortFlags.h"
#include "HAL/PlatformTime.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"

BlueprintUsageTracker::BlueprintUsageTracker()
	: LastScanTime(0.0)
{
}

BlueprintUsageTracker::~BlueprintUsageTracker()
{
}

BlueprintUsageTracker& BlueprintUsageTracker::Get()
{
	static BlueprintUsageTracker Instance;
	return Instance;
}

void BlueprintUsageTracker::ScanBlueprints()
{
	FScopeLock Lock(&UsageIndexLock);
	
	// Check if cache is still valid
	if (!IsCacheStale())
	{
		return;
	}
	
	// Clear existing index
	UsageIndex.Empty();
	
	// Get asset registry
	FAssetRegistryModule& AssetRegistryModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry"));
	IAssetRegistry& AssetRegistry = AssetRegistryModule.Get();
	
	// Wait for assets to be discovered
	AssetRegistry.SearchAllAssets(true);
	
	// Find all Blueprint assets
	TArray<FAssetData> BlueprintAssets;
	FARFilter Filter;
	Filter.ClassPaths.Add(UBlueprint::StaticClass()->GetClassPathName());
	Filter.bRecursiveClasses = true;
	
	// In UE 5.6, we need to use the asset registry properly
	AssetRegistry.GetAssets(Filter, BlueprintAssets);
	
	UE_LOG(LogTemp, Log, TEXT("BlueprintUsageTracker: Found %d Blueprint assets"), BlueprintAssets.Num());
	
	// Process each Blueprint
	for (const FAssetData& AssetData : BlueprintAssets)
	{
		FString BlueprintPath = AssetData.GetObjectPathString();
		
		// Load the Blueprint asset (read-only)
		// In UE 5.6, we use LoadAsset to get the Blueprint
		UBlueprint* Blueprint = Cast<UBlueprint>(StaticLoadObject(UBlueprint::StaticClass(), nullptr, *AssetData.GetObjectPathString()));
		if (Blueprint)
		{
			ExtractBlueprintUsage(Blueprint, BlueprintPath);
		}
	}
	
	LastScanTime = FPlatformTime::Seconds();
	
	UE_LOG(LogTemp, Log, TEXT("BlueprintUsageTracker: Scan complete, indexed %d symbols"), UsageIndex.Num());
}

void BlueprintUsageTracker::ExtractBlueprintUsage(UBlueprint* Blueprint, const FString& BlueprintPath)
{
	if (!Blueprint)
	{
		return;
	}
	
	// Get the generated class
	UClass* GeneratedClass = Blueprint->GeneratedClass;
	if (!GeneratedClass)
	{
		return;
	}
	
	// Get parent class
	UClass* ParentClass = Blueprint->ParentClass;
	if (!ParentClass)
	{
		return;
	}
	
	FString ParentClassName = ParentClass->GetName();
	
	// Check for function overrides
	for (TFieldIterator<UFunction> FuncIterator(GeneratedClass, EFieldIteratorFlags::ExcludeSuper); FuncIterator; ++FuncIterator)
	{
		UFunction* Function = *FuncIterator;
		if (Function)
		{
			FString FunctionName = Function->GetName();
			FString SymbolKey = FString::Printf(TEXT("%s::%s"), *ParentClassName, *FunctionName);
			
			FScopeLock Lock(&UsageIndexLock);
			FBlueprintUsageInfo& UsageInfo = UsageIndex.FindOrAdd(SymbolKey);
			UsageInfo.OverriddenInBlueprints.AddUnique(BlueprintPath);
			UsageInfo.UsageCount = UsageInfo.OverriddenInBlueprints.Num();
		}
	}
	
	// Check for property overrides
	for (TFieldIterator<FProperty> PropIterator(GeneratedClass, EFieldIteratorFlags::ExcludeSuper); PropIterator; ++PropIterator)
	{
		FProperty* Property = *PropIterator;
		if (Property)
		{
			FString PropertyName = Property->GetName();
			FString SymbolKey = FString::Printf(TEXT("%s::%s"), *ParentClassName, *PropertyName);
			
			FScopeLock Lock(&UsageIndexLock);
			FBlueprintUsageInfo& UsageInfo = UsageIndex.FindOrAdd(SymbolKey);
			UsageInfo.OverriddenInBlueprints.AddUnique(BlueprintPath);
			UsageInfo.UsageCount = UsageInfo.OverriddenInBlueprints.Num();
		}
	}
	
	// Check for function calls in the Blueprint graph
	// This is simplified - in a full implementation, we'd parse the Blueprint graph
	// For now, we check if functions from parent class are accessible (which implies they might be used)
	if (ParentClass)
	{
		for (TFieldIterator<UFunction> FuncIterator(ParentClass); FuncIterator; ++FuncIterator)
		{
			UFunction* Function = *FuncIterator;
			if (Function && Function->HasAnyFunctionFlags(FUNC_BlueprintCallable | FUNC_BlueprintEvent))
			{
				FString FunctionName = Function->GetName();
				FString SymbolKey = FString::Printf(TEXT("%s::%s"), *ParentClassName, *FunctionName);
				
				FScopeLock Lock(&UsageIndexLock);
				FBlueprintUsageInfo& UsageInfo = UsageIndex.FindOrAdd(SymbolKey);
				if (!UsageInfo.UsedInBlueprints.Contains(BlueprintPath))
				{
					UsageInfo.UsedInBlueprints.AddUnique(BlueprintPath);
					UsageInfo.UsageCount = UsageInfo.UsedInBlueprints.Num() + UsageInfo.OverriddenInBlueprints.Num();
				}
			}
		}
		
		// Check for property accesses
		for (TFieldIterator<FProperty> PropIterator(ParentClass); PropIterator; ++PropIterator)
		{
			FProperty* Property = *PropIterator;
			// Check if property is Blueprint-visible
			// BlueprintReadWrite = BlueprintVisible && !BlueprintReadOnly
			const bool bBlueprintVisible = Property->HasAnyPropertyFlags(CPF_BlueprintVisible);
			const bool bBlueprintReadOnly = Property->HasAnyPropertyFlags(CPF_BlueprintReadOnly);
			const bool bBlueprintReadWrite = bBlueprintVisible && !bBlueprintReadOnly;
			
			if (Property && (bBlueprintVisible || bBlueprintReadOnly || bBlueprintReadWrite))
			{
				FString PropertyName = Property->GetName();
				FString SymbolKey = FString::Printf(TEXT("%s::%s"), *ParentClassName, *PropertyName);
				
				FScopeLock Lock(&UsageIndexLock);
				FBlueprintUsageInfo& UsageInfo = UsageIndex.FindOrAdd(SymbolKey);
				if (!UsageInfo.UsedInBlueprints.Contains(BlueprintPath))
				{
					UsageInfo.UsedInBlueprints.AddUnique(BlueprintPath);
					UsageInfo.UsageCount = UsageInfo.UsedInBlueprints.Num() + UsageInfo.OverriddenInBlueprints.Num();
				}
			}
		}
	}
}

FBlueprintUsageInfo BlueprintUsageTracker::GetUsageData(const FString& SymbolName, const FString& ClassName)
{
	// Ensure cache is fresh (check outside lock)
	bool bNeedsScan = false;
	{
		FScopeLock Lock(&UsageIndexLock);
		bNeedsScan = IsCacheStale();
	}
	
	if (bNeedsScan)
	{
		ScanBlueprints();
	}
	
	FScopeLock Lock(&UsageIndexLock);
	FString SymbolKey = FString::Printf(TEXT("%s::%s"), *ClassName, *SymbolName);
	
	FBlueprintUsageInfo* UsageInfo = UsageIndex.Find(SymbolKey);
	if (UsageInfo)
	{
		return *UsageInfo;
	}
	
	return FBlueprintUsageInfo();
}

TMap<FString, FBlueprintUsageInfo> BlueprintUsageTracker::GetAllUsageData()
{
	// Ensure cache is fresh (check outside lock)
	bool bNeedsScan = false;
	{
		FScopeLock Lock(&UsageIndexLock);
		bNeedsScan = IsCacheStale();
	}
	
	if (bNeedsScan)
	{
		ScanBlueprints();
	}
	
	FScopeLock Lock(&UsageIndexLock);
	return UsageIndex;
}

void BlueprintUsageTracker::InvalidateCache()
{
	FScopeLock Lock(&UsageIndexLock);
	UsageIndex.Empty();
	LastScanTime = 0.0;
}

bool BlueprintUsageTracker::IsCacheStale() const
{
	// Cache is stale if older than 5 minutes (300 seconds)
	double CurrentTime = FPlatformTime::Seconds();
	return (CurrentTime - LastScanTime) > 300.0;
}

