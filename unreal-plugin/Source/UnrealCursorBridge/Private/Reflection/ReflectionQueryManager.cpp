// Copyright Epic Games, Inc. All Rights Reserved.

#include "Reflection/ReflectionQueryManager.h"
#include "IPC/IPCServer.h"
#include "UObject/UObjectIterator.h"
#include "UObject/Class.h"
#include "UObject/UnrealType.h"
#include "UObject/PropertyPortFlags.h"
#include "UObject/TextProperty.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Serialization/JsonSerializer.h"
#include "Engine/Engine.h"
#include "HAL/PlatformProcess.h"
#include "Misc/DateTime.h"
#include "Misc/Timespan.h"
#include "Async/Async.h"

ReflectionQueryManager::ReflectionQueryManager()
	: bCacheReady(false)
	, bCacheBuilding(false)
{
}

ReflectionQueryManager::~ReflectionQueryManager()
{
	// Save cache on shutdown
	if (bCacheReady)
	{
		SaveCacheToDisk();
	}
}

ReflectionQueryManager& ReflectionQueryManager::Get()
{
	static ReflectionQueryManager Instance;
	return Instance;
}

void ReflectionQueryManager::InitializeCache()
{
	UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager] InitializeCache called"));
	
	// Try to load from disk first
	if (LoadCacheFromDisk())
	{
		UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager] Cache loaded from disk successfully"));
		bCacheReady = true;
		
		// Emit cache ready event so extension knows cache is available
		FScopeLock Lock(&CacheLock);
		int32 ClassCount = ClassCache.Num();
		int32 SymbolCount = SymbolCache.Num();
		
		UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager] Cache ready from disk: %d classes, %d symbols"), ClassCount, SymbolCount);
		
		TSharedPtr<FJsonObject> ReadyEventData = MakeShareable(new FJsonObject);
		ReadyEventData->SetNumberField(TEXT("classCount"), ClassCount);
		ReadyEventData->SetNumberField(TEXT("symbolCount"), SymbolCount);
		UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager] Sending reflection.cacheReady event (loaded from disk)"));
		IPCServer::Get().SendEvent(TEXT("reflection.cacheReady"), ReadyEventData);
		return;
	}
	
	UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager] No cache on disk, building asynchronously"));
	// If no cache on disk, build it asynchronously
	BuildCacheAsync();
}

void ReflectionQueryManager::BuildCacheAsync()
{
	UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager] BuildCacheAsync called"));
	
	if (bCacheBuilding || bCacheReady)
	{
		UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager] Cache already building (%d) or ready (%d), skipping"), (int32)bCacheBuilding, (int32)bCacheReady);
		return; // Already building or ready
	}
	
	UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager] Starting cache build..."));
	bCacheBuilding = true;
	
	// Emit cache building event
	TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
	EventData->SetStringField(TEXT("message"), TEXT("Starting reflection cache build..."));
	UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager] Sending reflection.cacheBuilding event"));
	IPCServer::Get().SendEvent(TEXT("reflection.cacheBuilding"), EventData);
	
	// Build cache on background thread pool
	AsyncTask(ENamedThreads::AnyBackgroundThreadNormalTask, [this]()
	{
		// Marshal to Game Thread for UObject access
		AsyncTask(ENamedThreads::GameThread, [this]()
		{
			UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager] Starting BuildCache on Game Thread"));
			BuildCache();
			UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager] BuildCache completed"));
			
			bCacheReady = true;
			bCacheBuilding = false;
			
			// Save to disk
			UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager] Saving cache to disk"));
			SaveCacheToDisk();
			
			// Emit cache ready event
			FScopeLock Lock(&CacheLock);
			int32 ClassCount = ClassCache.Num();
			int32 SymbolCount = SymbolCache.Num();
			
			UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager] Cache ready: %d classes, %d symbols"), ClassCount, SymbolCount);
			
			TSharedPtr<FJsonObject> ReadyEventData = MakeShareable(new FJsonObject);
			ReadyEventData->SetNumberField(TEXT("classCount"), ClassCount);
			ReadyEventData->SetNumberField(TEXT("symbolCount"), SymbolCount);
			UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager] Sending reflection.cacheReady event"));
			IPCServer::Get().SendEvent(TEXT("reflection.cacheReady"), ReadyEventData);
		});
	});
}

bool ReflectionQueryManager::WaitForCacheReady(float TimeoutSeconds)
{
	const FDateTime StartTime = FDateTime::Now();
	
	while (!bCacheReady && !bCacheBuilding)
	{
		// Cache not initialized, start building
		BuildCacheAsync();
	}
	
	while (!bCacheReady)
	{
		const FTimespan Elapsed = FDateTime::Now() - StartTime;
		if (Elapsed.GetTotalSeconds() > TimeoutSeconds)
		{
			return false; // Timeout
		}
		
		FPlatformProcess::Sleep(0.1f); // Sleep 100ms
	}
	
	return true;
}

FString ReflectionQueryManager::GetCacheFilePath() const
{
	FString ProjectDir = FPaths::ProjectSavedDir();
	FString CacheDir = FPaths::Combine(ProjectDir, TEXT("UnrealCursorBridge"));
	
	// Ensure directory exists
	IPlatformFile& PlatformFile = FPlatformFileManager::Get().GetPlatformFile();
	if (!PlatformFile.DirectoryExists(*CacheDir))
	{
		PlatformFile.CreateDirectoryTree(*CacheDir);
	}
	
	return FPaths::Combine(CacheDir, TEXT("ReflectionCache.json"));
}

bool ReflectionQueryManager::LoadCacheFromDisk()
{
	FString CacheFilePath = GetCacheFilePath();
	
	if (!FPlatformFileManager::Get().GetPlatformFile().FileExists(*CacheFilePath))
	{
		return false; // No cache file
	}
	
	FString JsonString;
	if (!FFileHelper::LoadFileToString(JsonString, *CacheFilePath))
	{
		return false; // Failed to read
	}
	
	TSharedPtr<FJsonObject> RootObject;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonString);
	
	if (!FJsonSerializer::Deserialize(Reader, RootObject) || !RootObject.IsValid())
	{
		return false; // Failed to parse
	}
	
	FScopeLock Lock(&CacheLock);
	
	// Load class cache
	const TSharedPtr<FJsonObject>* ClassCacheObject = nullptr;
	if (RootObject->TryGetObjectField(TEXT("classCache"), ClassCacheObject) && ClassCacheObject && ClassCacheObject->IsValid())
	{
		ClassCache.Empty();
		for (const auto& Pair : ClassCacheObject->Get()->Values)
		{
			ClassCache.Add(Pair.Key, Pair.Value->AsObject());
		}
	}
	
	// Load symbol cache
	const TSharedPtr<FJsonObject>* SymbolCacheObject = nullptr;
	if (RootObject->TryGetObjectField(TEXT("symbolCache"), SymbolCacheObject) && SymbolCacheObject && SymbolCacheObject->IsValid())
	{
		SymbolCache.Empty();
		for (const auto& Pair : SymbolCacheObject->Get()->Values)
		{
			SymbolCache.Add(Pair.Key, Pair.Value->AsObject());
		}
	}
	
	// Load class functions cache
	const TSharedPtr<FJsonObject>* FunctionsCacheObject = nullptr;
	if (RootObject->TryGetObjectField(TEXT("classFunctionsCache"), FunctionsCacheObject) && FunctionsCacheObject && FunctionsCacheObject->IsValid())
	{
		ClassFunctionsCache.Empty();
		for (const auto& Pair : FunctionsCacheObject->Get()->Values)
		{
			const TArray<TSharedPtr<FJsonValue>>* FunctionsArray = nullptr;
			if (Pair.Value->TryGetArray(FunctionsArray))
			{
				TArray<TSharedPtr<FJsonObject>> Functions;
				for (const auto& FuncValue : *FunctionsArray)
				{
					if (FuncValue->Type == EJson::Object)
					{
						Functions.Add(FuncValue->AsObject());
					}
				}
				ClassFunctionsCache.Add(Pair.Key, Functions);
			}
		}
	}
	
	// Load class properties cache
	const TSharedPtr<FJsonObject>* PropertiesCacheObject = nullptr;
	if (RootObject->TryGetObjectField(TEXT("classPropertiesCache"), PropertiesCacheObject) && PropertiesCacheObject && PropertiesCacheObject->IsValid())
	{
		ClassPropertiesCache.Empty();
		for (const auto& Pair : PropertiesCacheObject->Get()->Values)
		{
			const TArray<TSharedPtr<FJsonValue>>* PropertiesArray = nullptr;
			if (Pair.Value->TryGetArray(PropertiesArray))
			{
				TArray<TSharedPtr<FJsonObject>> Properties;
				for (const auto& PropValue : *PropertiesArray)
				{
					if (PropValue->Type == EJson::Object)
					{
						Properties.Add(PropValue->AsObject());
					}
				}
				ClassPropertiesCache.Add(Pair.Key, Properties);
			}
		}
	}
	
	return true;
}

void ReflectionQueryManager::SaveCacheToDisk()
{
	FScopeLock Lock(&CacheLock);
	
	TSharedPtr<FJsonObject> RootObject = MakeShareable(new FJsonObject);
	
	// Save class cache
	TSharedPtr<FJsonObject> ClassCacheObject = MakeShareable(new FJsonObject);
	for (const auto& Pair : ClassCache)
	{
		ClassCacheObject->SetObjectField(Pair.Key, Pair.Value);
	}
	RootObject->SetObjectField(TEXT("classCache"), ClassCacheObject);
	
	// Save symbol cache
	TSharedPtr<FJsonObject> SymbolCacheObject = MakeShareable(new FJsonObject);
	for (const auto& Pair : SymbolCache)
	{
		SymbolCacheObject->SetObjectField(Pair.Key, Pair.Value);
	}
	RootObject->SetObjectField(TEXT("symbolCache"), SymbolCacheObject);
	
	// Save class functions cache
	TSharedPtr<FJsonObject> FunctionsCacheObject = MakeShareable(new FJsonObject);
	for (const auto& Pair : ClassFunctionsCache)
	{
		TArray<TSharedPtr<FJsonValue>> FunctionsArray;
		for (const auto& Func : Pair.Value)
		{
			FunctionsArray.Add(MakeShareable(new FJsonValueObject(Func)));
		}
		FunctionsCacheObject->SetArrayField(Pair.Key, FunctionsArray);
	}
	RootObject->SetObjectField(TEXT("classFunctionsCache"), FunctionsCacheObject);
	
	// Save class properties cache
	TSharedPtr<FJsonObject> PropertiesCacheObject = MakeShareable(new FJsonObject);
	for (const auto& Pair : ClassPropertiesCache)
	{
		TArray<TSharedPtr<FJsonValue>> PropertiesArray;
		for (const auto& Prop : Pair.Value)
		{
			PropertiesArray.Add(MakeShareable(new FJsonValueObject(Prop)));
		}
		PropertiesCacheObject->SetArrayField(Pair.Key, PropertiesArray);
	}
	RootObject->SetObjectField(TEXT("classPropertiesCache"), PropertiesCacheObject);
	
	// Serialize to string
	FString OutputString;
	TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutputString);
	FJsonSerializer::Serialize(RootObject.ToSharedRef(), Writer);
	
	// Write to file
	FString CacheFilePath = GetCacheFilePath();
	FFileHelper::SaveStringToFile(OutputString, *CacheFilePath);
}

void ReflectionQueryManager::BuildCache()
{
	UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager::BuildCache] Starting cache build"));
	
	// Clear existing caches
	{
		FScopeLock Lock(&CacheLock);
		ClassCache.Empty();
		SymbolCache.Empty();
		ClassFunctionsCache.Empty();
		ClassPropertiesCache.Empty();
	}
	
	// Collect all classes first (no lock needed for iteration)
	TArray<UClass*> AllClasses;
	for (TObjectIterator<UClass> ClassIterator; ClassIterator; ++ClassIterator)
	{
		UClass* Class = *ClassIterator;
		if (Class && !Class->HasAnyClassFlags(CLASS_Deprecated | CLASS_NewerVersionExists))
		{
			AllClasses.Add(Class);
		}
	}
	
	int32 TotalClasses = AllClasses.Num();
	int32 ProcessedClasses = 0;
	
	UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager::BuildCache] Found %d classes to process"), TotalClasses);
	
	// Build cache for each class
	for (UClass* Class : AllClasses)
	{
		// Build cache for this class (lock is handled inside BuildCacheForClass)
		BuildCacheForClass(Class);
		ProcessedClasses++;
		
		// Emit progress event every 10% or every 50 classes, whichever is more frequent
		if (TotalClasses > 0 && (ProcessedClasses % FMath::Max(1, TotalClasses / 10) == 0 || ProcessedClasses % 50 == 0))
		{
			int32 Percent = (ProcessedClasses * 100) / TotalClasses;
			
			UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager::BuildCache] Progress: %d%% (%d/%d classes)"), Percent, ProcessedClasses, TotalClasses);
			
			TSharedPtr<FJsonObject> ProgressEventData = MakeShareable(new FJsonObject);
			ProgressEventData->SetNumberField(TEXT("percent"), Percent);
			ProgressEventData->SetStringField(TEXT("message"), FString::Printf(TEXT("Processing classes (%d/%d)"), ProcessedClasses, TotalClasses));
			UE_LOG(LogTemp, Log, TEXT("[ReflectionQueryManager::BuildCache] Sending reflection.cacheProgress event: %d%%"), Percent);
			IPCServer::Get().SendEvent(TEXT("reflection.cacheProgress"), ProgressEventData);
		}
	}
}

void ReflectionQueryManager::BuildCacheForClass(UClass* Class)
{
	if (!Class)
	{
		return;
	}
	
	FString ClassName = Class->GetName();
	
	FScopeLock Lock(&CacheLock);
	
	// Cache class data
	TSharedPtr<FJsonObject> ClassJson = ClassToJson(Class);
	if (ClassJson.IsValid())
	{
		ClassCache.Add(ClassName, ClassJson);
		
		// Add to symbol cache
		TSharedPtr<FJsonObject> SymbolJson = MakeShareable(new FJsonObject(*ClassJson));
		SymbolJson->SetStringField(TEXT("symbolType"), TEXT("class"));
		SymbolCache.Add(ClassName, SymbolJson);
	}
	
	// Cache functions
	TArray<TSharedPtr<FJsonObject>> Functions;
	for (TFieldIterator<UFunction> FuncIterator(Class, EFieldIteratorFlags::ExcludeSuper); FuncIterator; ++FuncIterator)
	{
		UFunction* Function = *FuncIterator;
		if (Function)
		{
			TSharedPtr<FJsonObject> FuncJson = FunctionToJson(Function);
			if (FuncJson.IsValid())
			{
				Functions.Add(FuncJson);
				
				// Add to symbol cache
				FString FuncName = Function->GetName();
				TSharedPtr<FJsonObject> SymbolJson = MakeShareable(new FJsonObject(*FuncJson));
				SymbolJson->SetStringField(TEXT("symbolType"), TEXT("function"));
				SymbolJson->SetStringField(TEXT("className"), ClassName);
				SymbolCache.Add(FuncName, SymbolJson);
			}
		}
	}
	ClassFunctionsCache.Add(ClassName, Functions);
	
	// Cache properties
	TArray<TSharedPtr<FJsonObject>> Properties;
	for (TFieldIterator<FProperty> PropIterator(Class, EFieldIteratorFlags::ExcludeSuper); PropIterator; ++PropIterator)
	{
		FProperty* Property = *PropIterator;
		if (Property)
		{
			TSharedPtr<FJsonObject> PropJson = PropertyToJson(Property);
			if (PropJson.IsValid())
			{
				Properties.Add(PropJson);
				
				// Add to symbol cache
				FString PropName = Property->GetName();
				TSharedPtr<FJsonObject> SymbolJson = MakeShareable(new FJsonObject(*PropJson));
				SymbolJson->SetStringField(TEXT("symbolType"), TEXT("property"));
				SymbolJson->SetStringField(TEXT("className"), ClassName);
				SymbolCache.Add(PropName, SymbolJson);
			}
		}
	}
	ClassPropertiesCache.Add(ClassName, Properties);
}

TArray<FString> ReflectionQueryManager::ListClasses()
{
	TArray<FString> ClassNames;
	
	for (TObjectIterator<UClass> ClassIterator; ClassIterator; ++ClassIterator)
	{
		UClass* Class = *ClassIterator;
		if (Class && !Class->HasAnyClassFlags(CLASS_Deprecated | CLASS_NewerVersionExists))
		{
			ClassNames.Add(Class->GetName());
		}
	}
	
	return ClassNames;
}

TSharedPtr<FJsonObject> ReflectionQueryManager::GetClass(const FString& ClassName)
{
	FScopeLock Lock(&CacheLock);
	
	// Check cache first
	if (ClassCache.Contains(ClassName))
	{
		return ClassCache[ClassName];
	}
	
	// Find the class
	UClass* Class = FindObject<UClass>(nullptr, *ClassName);
	if (!Class)
	{
		// Try with full path
		Class = LoadClass<UObject>(nullptr, *ClassName);
	}
	
	if (!Class)
	{
		return nullptr;
	}
	
	TSharedPtr<FJsonObject> ClassJson = ClassToJson(Class);
	
	// Cache it
	ClassCache.Add(ClassName, ClassJson);
	
	return ClassJson;
}

TArray<TSharedPtr<FJsonObject>> ReflectionQueryManager::GetFunctions(const FString& ClassName)
{
	FScopeLock Lock(&CacheLock);
	
	// Check cache first
	if (ClassFunctionsCache.Contains(ClassName))
	{
		return ClassFunctionsCache[ClassName];
	}
	
	// Fallback to building on demand
	UClass* Class = FindObject<UClass>(nullptr, *ClassName);
	if (!Class)
	{
		Class = LoadClass<UObject>(nullptr, *ClassName);
	}
	
	if (!Class)
	{
		return TArray<TSharedPtr<FJsonObject>>();
	}
	
	// Build and cache
	BuildCacheForClass(Class);
	
	if (ClassFunctionsCache.Contains(ClassName))
	{
		return ClassFunctionsCache[ClassName];
	}
	
	return TArray<TSharedPtr<FJsonObject>>();
}

TArray<TSharedPtr<FJsonObject>> ReflectionQueryManager::GetProperties(const FString& ClassName)
{
	FScopeLock Lock(&CacheLock);
	
	// Check cache first
	if (ClassPropertiesCache.Contains(ClassName))
	{
		return ClassPropertiesCache[ClassName];
	}
	
	// Fallback to building on demand
	UClass* Class = FindObject<UClass>(nullptr, *ClassName);
	if (!Class)
	{
		Class = LoadClass<UObject>(nullptr, *ClassName);
	}
	
	if (!Class)
	{
		return TArray<TSharedPtr<FJsonObject>>();
	}
	
	// Build and cache
	BuildCacheForClass(Class);
	
	if (ClassPropertiesCache.Contains(ClassName))
	{
		return ClassPropertiesCache[ClassName];
	}
	
	return TArray<TSharedPtr<FJsonObject>>();
}

TSharedPtr<FJsonObject> ReflectionQueryManager::FindSymbol(const FString& SymbolName)
{
	bool bNeedsWait = false;
	
	// First check: Look in cache while holding lock
	{
		FScopeLock Lock(&CacheLock);
		
		// OPTIMIZED: Use symbol cache for O(1) lookup instead of iterating
		if (SymbolCache.Contains(SymbolName))
		{
			return SymbolCache[SymbolName];
		}
		
		// If cache not ready, wait a bit and try again
		if (!bCacheReady && !bCacheBuilding)
		{
			// Cache not initialized, start building
			BuildCacheAsync();
			// Return null for now, will be available after cache builds
			return nullptr;
		}
		
		// If cache is building, we need to wait (but release lock first)
		if (bCacheBuilding)
		{
			bNeedsWait = true;
		}
	} // Lock released here
	
	// Wait for cache if needed (outside of lock to avoid blocking)
	if (bNeedsWait)
	{
		WaitForCacheReady(5.0f); // Wait up to 5 seconds
	}
	
	// Re-acquire lock for final checks and fallback
	{
		FScopeLock Lock(&CacheLock);
		
		// Try cache again (cache might be ready now)
		if (SymbolCache.Contains(SymbolName))
		{
			return SymbolCache[SymbolName];
		}
		
		// Fallback: Try as class (this uses ClassCache which is faster)
		TSharedPtr<FJsonObject> Result = GetClass(SymbolName);
		if (Result.IsValid())
		{
			// Add to symbol cache for future lookups
			TSharedPtr<FJsonObject> SymbolJson = MakeShareable(new FJsonObject(*Result));
			SymbolJson->SetStringField(TEXT("symbolType"), TEXT("class"));
			SymbolCache.Add(SymbolName, SymbolJson);
			return Result;
		}
	} // Lock released here
	
	// Not found in cache - return null
	// Note: If symbol exists but cache isn't built yet, it will be found after cache completes
	return nullptr;
}

TSharedPtr<FJsonObject> ReflectionQueryManager::GetCDODefaults(const FString& ClassName)
{
	UClass* Class = FindObject<UClass>(nullptr, *ClassName);
	if (!Class)
	{
		Class = LoadClass<UObject>(nullptr, *ClassName);
	}
	
	if (!Class)
	{
		return nullptr;
	}
	
	UObject* CDO = Class->GetDefaultObject();
	if (!CDO)
	{
		return nullptr;
	}
	
	TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
	Result->SetStringField(TEXT("className"), ClassName);
	
	TSharedPtr<FJsonObject> Defaults = MakeShareable(new FJsonObject);
	
	// Iterate through properties and get their default values
	for (TFieldIterator<FProperty> PropIterator(Class); PropIterator; ++PropIterator)
	{
		FProperty* Property = *PropIterator;
		if (!Property)
		{
			continue;
		}
		
		FString PropertyName = Property->GetName();
		
		// Export property value as string (UE 5.6 API)
		// Note: ExportTextItem API changed in UE 5.6 - method signature is different
		// For now, we'll skip CDO default value export
		// TODO: Re-implement using correct UE 5.6 property export API
		// The correct method may be ExportTextItem_Direct or a different signature
		/*
		FString PropertyValue;
		void* DataPtr = Property->ContainerPtrToValuePtr<void>(CDO);
		if (DataPtr)
		{
			// UE 5.6: Need to find correct ExportTextItem signature
			// Property->ExportTextItem(...);
		}
		
		if (!PropertyValue.IsEmpty())
		{
			Defaults->SetStringField(PropertyName, PropertyValue);
		}
		*/
	}
	
	Result->SetObjectField(TEXT("defaults"), Defaults);
	
	return Result;
}

TSharedPtr<FJsonObject> ReflectionQueryManager::ClassToJson(UClass* Class)
{
	if (!Class)
	{
		return nullptr;
	}
	
	TSharedPtr<FJsonObject> ClassJson = MakeShareable(new FJsonObject);
	ClassJson->SetStringField(TEXT("name"), Class->GetName());
	ClassJson->SetStringField(TEXT("fullName"), Class->GetFullName());
	
	// Inheritance chain
	TArray<TSharedPtr<FJsonValue>> InheritanceChain;
	UClass* CurrentClass = Class;
	while (CurrentClass && CurrentClass != UObject::StaticClass())
	{
		InheritanceChain.Add(MakeShareable(new FJsonValueString(CurrentClass->GetName())));
		CurrentClass = CurrentClass->GetSuperClass();
	}
	ClassJson->SetArrayField(TEXT("inheritanceChain"), InheritanceChain);
	
	if (Class->GetSuperClass())
	{
		ClassJson->SetStringField(TEXT("super"), Class->GetSuperClass()->GetName());
	}
	
	// Metadata - UE 5.6: GetMetaDataMap() doesn't exist, iterate through known metadata keys
	TSharedPtr<FJsonObject> MetadataObject = MakeShareable(new FJsonObject);
	// Get common metadata keys
	TArray<FName> CommonKeys = { TEXT("BlueprintType"), TEXT("Blueprintable"), TEXT("Config"), TEXT("Category"), TEXT("Tooltip"), TEXT("Comment") };
	for (const FName& Key : CommonKeys)
	{
		FString Value = Class->GetMetaData(Key);
		if (!Value.IsEmpty())
		{
			MetadataObject->SetStringField(Key.ToString(), Value);
		}
	}
	ClassJson->SetObjectField(TEXT("metadata"), MetadataObject);
	
	// Module
	FString ModuleName = Class->GetOutermost()->GetName();
	ClassJson->SetStringField(TEXT("module"), ModuleName);
	
	return ClassJson;
}

TSharedPtr<FJsonObject> ReflectionQueryManager::FunctionToJson(UFunction* Function)
{
	if (!Function)
	{
		return nullptr;
	}
	
	TSharedPtr<FJsonObject> FuncJson = MakeShareable(new FJsonObject);
	FuncJson->SetStringField(TEXT("name"), Function->GetName());
	FuncJson->SetStringField(TEXT("fullName"), Function->GetFullName());
	
	// Return type
	FProperty* ReturnProp = Function->GetReturnProperty();
	if (ReturnProp)
	{
		FuncJson->SetStringField(TEXT("returnType"), ReturnProp->GetCPPType());
	}
	else
	{
		FuncJson->SetStringField(TEXT("returnType"), TEXT("void"));
	}
	
	// Parameters
	TArray<TSharedPtr<FJsonValue>> Parameters;
	for (TFieldIterator<FProperty> ParamIterator(Function); ParamIterator; ++ParamIterator)
	{
		FProperty* Param = *ParamIterator;
		if (Param && Param != ReturnProp)
		{
			TSharedPtr<FJsonObject> ParamJson = MakeShareable(new FJsonObject);
			ParamJson->SetStringField(TEXT("name"), Param->GetName());
			ParamJson->SetStringField(TEXT("type"), Param->GetCPPType());
			Parameters.Add(MakeShareable(new FJsonValueObject(ParamJson)));
		}
	}
	FuncJson->SetArrayField(TEXT("parameters"), Parameters);
	
	// Function flags
	TArray<TSharedPtr<FJsonValue>> Flags;
	if (Function->HasAnyFunctionFlags(FUNC_BlueprintCallable))
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("BlueprintCallable"))));
	}
	if (Function->HasAnyFunctionFlags(FUNC_BlueprintEvent))
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("BlueprintEvent"))));
	}
	if (Function->HasAnyFunctionFlags(FUNC_Net))
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("Net"))));
	}
	if (Function->HasAnyFunctionFlags(FUNC_NetReliable))
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("NetReliable"))));
	}
	if (Function->HasAnyFunctionFlags(FUNC_NetServer))
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("Server"))));
	}
	if (Function->HasAnyFunctionFlags(FUNC_NetClient))
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("Client"))));
	}
	if (Function->HasAnyFunctionFlags(FUNC_NetMulticast))
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("NetMulticast"))));
	}
	FuncJson->SetArrayField(TEXT("flags"), Flags);
	
	// Metadata - UE 5.6: GetMetaDataMap() doesn't exist, iterate through known metadata keys
	TSharedPtr<FJsonObject> MetadataObject = MakeShareable(new FJsonObject);
	// Get common metadata keys
	TArray<FName> CommonKeys = { TEXT("CallInEditor"), TEXT("Category"), TEXT("Tooltip"), TEXT("Comment"), TEXT("CustomThunk") };
	for (const FName& Key : CommonKeys)
	{
		FString Value = Function->GetMetaData(Key);
		if (!Value.IsEmpty())
		{
			MetadataObject->SetStringField(Key.ToString(), Value);
		}
	}
	FuncJson->SetObjectField(TEXT("metadata"), MetadataObject);
	
	// RPC info
	if (Function->HasAnyFunctionFlags(FUNC_Net))
	{
		TSharedPtr<FJsonObject> NetJson = MakeShareable(new FJsonObject);
		
		FString RPCType;
		if (Function->HasAnyFunctionFlags(FUNC_NetServer))
		{
			RPCType = TEXT("Server");
		}
		else if (Function->HasAnyFunctionFlags(FUNC_NetClient))
		{
			RPCType = TEXT("Client");
		}
		else if (Function->HasAnyFunctionFlags(FUNC_NetMulticast))
		{
			RPCType = TEXT("Multicast");
		}
		
		NetJson->SetStringField(TEXT("rpc"), RPCType);
		NetJson->SetBoolField(TEXT("reliable"), Function->HasAnyFunctionFlags(FUNC_NetReliable));
		
		FuncJson->SetObjectField(TEXT("net"), NetJson);
	}
	
	return FuncJson;
}

TSharedPtr<FJsonObject> ReflectionQueryManager::PropertyToJson(FProperty* Property)
{
	if (!Property)
	{
		return nullptr;
	}
	
	TSharedPtr<FJsonObject> PropJson = MakeShareable(new FJsonObject);
	PropJson->SetStringField(TEXT("name"), Property->GetName());
	PropJson->SetStringField(TEXT("cppType"), Property->GetCPPType());
	PropJson->SetStringField(TEXT("fullName"), Property->GetFullName());
	
	// Property flags - Correct Unreal reflection semantics
	// UPROPERTY specifiers are NOT EPropertyFlags - they translate to flags + metadata
	TArray<TSharedPtr<FJsonValue>> Flags;
	
	// Edit / EditAnywhere / EditDefaultsOnly / EditInstanceOnly
	const bool bEditable = Property->HasAnyPropertyFlags(CPF_Edit);
	if (bEditable)
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("Edit"))));
		
		// EditAnywhere = Edit && !EditDefaultsOnly && !EditInstanceOnly
		const bool bEditDefaultsOnly = Property->HasMetaData(TEXT("EditDefaultsOnly"));
		const bool bEditInstanceOnly = Property->HasMetaData(TEXT("EditInstanceOnly"));
		if (!bEditDefaultsOnly && !bEditInstanceOnly)
		{
			Flags.Add(MakeShareable(new FJsonValueString(TEXT("EditAnywhere"))));
		}
		else if (bEditDefaultsOnly)
		{
			Flags.Add(MakeShareable(new FJsonValueString(TEXT("EditDefaultsOnly"))));
		}
		else if (bEditInstanceOnly)
		{
			Flags.Add(MakeShareable(new FJsonValueString(TEXT("EditInstanceOnly"))));
		}
	}
	
	// Blueprint visibility
	const bool bBlueprintVisible = Property->HasAnyPropertyFlags(CPF_BlueprintVisible);
	const bool bBlueprintReadOnly = Property->HasAnyPropertyFlags(CPF_BlueprintReadOnly);
	
	if (bBlueprintReadOnly)
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("BlueprintReadOnly"))));
	}
	
	// BlueprintReadWrite = BlueprintVisible && !BlueprintReadOnly
	if (bBlueprintVisible && !bBlueprintReadOnly)
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("BlueprintReadWrite"))));
	}
	
	// Replication - Replicated is NOT a flag, it's CPF_Net
	const bool bReplicated = Property->HasAnyPropertyFlags(CPF_Net);
	if (bReplicated)
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("Replicated"))));
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("Net"))));
	}
	PropJson->SetArrayField(TEXT("flags"), Flags);
	
	// Metadata - UE 5.6: GetMetaDataMap() returns pointer, iterate through known keys
	TSharedPtr<FJsonObject> MetadataObject = MakeShareable(new FJsonObject);
	// Get common metadata keys
	TArray<FName> CommonKeys = { TEXT("Category"), TEXT("Tooltip"), TEXT("Comment"), TEXT("ReplicatedUsing"), TEXT("DisplayName") };
	for (const FName& Key : CommonKeys)
	{
		FString Value = Property->GetMetaData(Key);
		if (!Value.IsEmpty())
		{
			MetadataObject->SetStringField(Key.ToString(), Value);
		}
	}
	PropJson->SetObjectField(TEXT("metadata"), MetadataObject);
	
	// Category
	FString Category = Property->GetMetaData(TEXT("Category"));
	if (!Category.IsEmpty())
	{
		PropJson->SetStringField(TEXT("category"), Category);
	}
	
	// Replication - Replicated is CPF_Net, not CPF_Replicated
	if (Property->HasAnyPropertyFlags(CPF_Net))
	{
		TSharedPtr<FJsonObject> ReplicationJson = MakeShareable(new FJsonObject);
		ReplicationJson->SetBoolField(TEXT("enabled"), true);
		
		FString ReplicatedUsing = Property->GetMetaData(TEXT("ReplicatedUsing"));
		if (ReplicatedUsing.IsEmpty())
		{
			ReplicatedUsing = TEXT("None");
		}
		ReplicationJson->SetStringField(TEXT("condition"), ReplicatedUsing);
		
		PropJson->SetObjectField(TEXT("replication"), ReplicationJson);
	}
	
	return PropJson;
}


void ReflectionQueryManager::InvalidateCache()
{
	FScopeLock Lock(&CacheLock);
	ClassCache.Empty();
}


