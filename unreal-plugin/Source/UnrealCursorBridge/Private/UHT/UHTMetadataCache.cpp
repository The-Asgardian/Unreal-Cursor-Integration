// Copyright Epic Games, Inc. All Rights Reserved.

#include "UHT/UHTMetadataCache.h"
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "HAL/PlatformFilemanager.h"
#include "HAL/PlatformTime.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Serialization/JsonSerializer.h"

UHTMetadataCache::UHTMetadataCache()
{
	// Set cache directory to Saved/UnrealCursorBridge/UHTMetadata/
	FString ProjectDir = FPaths::GetPath(FPaths::GetProjectFilePath());
	CacheDirectory = FPaths::Combine(ProjectDir, TEXT("Saved"), TEXT("UnrealCursorBridge"), TEXT("UHTMetadata"));
	
	// Create directory if it doesn't exist
	IFileManager::Get().MakeDirectory(*CacheDirectory, true);
}

UHTMetadataCache::~UHTMetadataCache()
{
}

UHTMetadataCache& UHTMetadataCache::Get()
{
	static UHTMetadataCache Instance;
	return Instance;
}

TArray<FUHTClassMetadata> UHTMetadataCache::GetModuleMetadata(const FString& ModuleName, bool bForceRefresh)
{
	FScopeLock Lock(&CacheLock);
	
	// Check if we have valid cached data
	if (!bForceRefresh && CachedMetadata.Contains(ModuleName))
	{
		if (IsCacheValid(ModuleName))
		{
			return CachedMetadata[ModuleName];
		}
	}
	
	// Try to load from disk first
	TArray<FUHTClassMetadata> Metadata;
	if (!bForceRefresh && LoadCache(ModuleName, Metadata))
	{
		CachedMetadata.Add(ModuleName, Metadata);
		CacheTimestamps.Add(ModuleName, FPlatformTime::Seconds());
		return Metadata;
	}
	
	// Extract from generated headers
	Metadata = UHTMetadataExtractor::Get().ExtractFromModule(ModuleName);
	
	// Cache the results
	CachedMetadata.Add(ModuleName, Metadata);
	CacheTimestamps.Add(ModuleName, FPlatformTime::Seconds());
	
	// Save to disk
	SaveCache(ModuleName, Metadata);
	
	return Metadata;
}

bool UHTMetadataCache::GetClassMetadata(const FString& ModuleName, const FString& ClassName, FUHTClassMetadata& OutMetadata)
{
	FScopeLock Lock(&CacheLock);
	
	TArray<FUHTClassMetadata> ModuleMetadata = GetModuleMetadata(ModuleName);
	
	for (const FUHTClassMetadata& ClassMetadata : ModuleMetadata)
	{
		if (ClassMetadata.Name == ClassName)
		{
			OutMetadata = ClassMetadata;
			return true;
		}
	}
	
	return false;
}

void UHTMetadataCache::InvalidateModule(const FString& ModuleName)
{
	FScopeLock Lock(&CacheLock);
	
	CachedMetadata.Remove(ModuleName);
	CacheTimestamps.Remove(ModuleName);
	
	// Delete cache file
	FString CacheFile = GetCacheFilePath(ModuleName);
	if (FPaths::FileExists(CacheFile))
	{
		IFileManager::Get().Delete(*CacheFile);
	}
}

void UHTMetadataCache::ClearAll()
{
	FScopeLock Lock(&CacheLock);
	
	CachedMetadata.Empty();
	CacheTimestamps.Empty();
	
	// Delete all cache files
	if (FPaths::DirectoryExists(CacheDirectory))
	{
		TArray<FString> Files;
		IFileManager::Get().FindFiles(Files, *(CacheDirectory / TEXT("*.json")), true, false);
		
		for (const FString& File : Files)
		{
			IFileManager::Get().Delete(*(CacheDirectory / File));
		}
	}
}

bool UHTMetadataCache::SaveCache(const FString& ModuleName, const TArray<FUHTClassMetadata>& Metadata)
{
	FString CacheFile = GetCacheFilePath(ModuleName);
	
	TSharedPtr<FJsonObject> RootObject = MakeShareable(new FJsonObject);
	RootObject->SetStringField(TEXT("module"), ModuleName);
	RootObject->SetNumberField(TEXT("timestamp"), FPlatformTime::Seconds());
	
	TArray<TSharedPtr<FJsonValue>> ClassesArray;
	
	for (const FUHTClassMetadata& ClassMetadata : Metadata)
	{
		TSharedPtr<FJsonObject> ClassObject = MakeShareable(new FJsonObject);
		ClassObject->SetStringField(TEXT("name"), ClassMetadata.Name);
		ClassObject->SetStringField(TEXT("super"), ClassMetadata.Super);
		ClassObject->SetStringField(TEXT("module"), ClassMetadata.Module);
		
		// Metadata
		TSharedPtr<FJsonObject> MetadataObject = MakeShareable(new FJsonObject);
		for (const auto& Pair : ClassMetadata.Metadata)
		{
			MetadataObject->SetStringField(Pair.Key, Pair.Value);
		}
		ClassObject->SetObjectField(TEXT("metadata"), MetadataObject);
		
		// Properties - convert FJsonObject to FJsonValue
		TArray<TSharedPtr<FJsonValue>> PropertiesArray;
		for (const TSharedPtr<FJsonObject>& Prop : ClassMetadata.Properties)
		{
			PropertiesArray.Add(MakeShareable(new FJsonValueObject(Prop)));
		}
		ClassObject->SetArrayField(TEXT("properties"), PropertiesArray);
		
		// Functions - convert FJsonObject to FJsonValue
		TArray<TSharedPtr<FJsonValue>> FunctionsArray;
		for (const TSharedPtr<FJsonObject>& Func : ClassMetadata.Functions)
		{
			FunctionsArray.Add(MakeShareable(new FJsonValueObject(Func)));
		}
		ClassObject->SetArrayField(TEXT("functions"), FunctionsArray);
		
		ClassesArray.Add(MakeShareable(new FJsonValueObject(ClassObject)));
	}
	
	RootObject->SetArrayField(TEXT("classes"), ClassesArray);
	
	// Serialize to string
	FString OutputString;
	TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&OutputString);
	FJsonSerializer::Serialize(RootObject.ToSharedRef(), Writer);
	
	// Write to file
	return FFileHelper::SaveStringToFile(OutputString, *CacheFile);
}

bool UHTMetadataCache::LoadCache(const FString& ModuleName, TArray<FUHTClassMetadata>& OutMetadata)
{
	FString CacheFile = GetCacheFilePath(ModuleName);
	
	if (!FPaths::FileExists(CacheFile))
	{
		return false;
	}
	
	// Check if cache is valid
	if (!IsCacheValid(ModuleName))
	{
		return false;
	}
	
	FString FileContent;
	if (!FFileHelper::LoadFileToString(FileContent, *CacheFile))
	{
		return false;
	}
	
	TSharedPtr<FJsonObject> RootObject;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(FileContent);
	
	if (!FJsonSerializer::Deserialize(Reader, RootObject) || !RootObject.IsValid())
	{
		return false;
	}
	
	const TArray<TSharedPtr<FJsonValue>>* ClassesArray = nullptr;
	if (!RootObject->TryGetArrayField(TEXT("classes"), ClassesArray))
	{
		return false;
	}
	
	for (const TSharedPtr<FJsonValue>& ClassValue : *ClassesArray)
	{
		const TSharedPtr<FJsonObject>* ClassObject = nullptr;
		if (!ClassValue->TryGetObject(ClassObject))
		{
			continue;
		}
		
		FUHTClassMetadata ClassMetadata;
		(*ClassObject)->TryGetStringField(TEXT("name"), ClassMetadata.Name);
		(*ClassObject)->TryGetStringField(TEXT("super"), ClassMetadata.Super);
		(*ClassObject)->TryGetStringField(TEXT("module"), ClassMetadata.Module);
		
		// Metadata
		const TSharedPtr<FJsonObject>* MetadataObject = nullptr;
		if ((*ClassObject)->TryGetObjectField(TEXT("metadata"), MetadataObject))
		{
			for (const auto& Pair : (*MetadataObject)->Values)
			{
				FString Value;
				if (Pair.Value->TryGetString(Value))
				{
					ClassMetadata.Metadata.Add(Pair.Key, Value);
				}
			}
		}
		
		// Properties
		const TArray<TSharedPtr<FJsonValue>>* PropertiesArray = nullptr;
		if ((*ClassObject)->TryGetArrayField(TEXT("properties"), PropertiesArray))
		{
			for (const TSharedPtr<FJsonValue>& PropValue : *PropertiesArray)
			{
				const TSharedPtr<FJsonObject>* PropObject = nullptr;
				if (PropValue->TryGetObject(PropObject))
				{
					ClassMetadata.Properties.Add(*PropObject);
				}
			}
		}
		
		// Functions
		const TArray<TSharedPtr<FJsonValue>>* FunctionsArray = nullptr;
		if ((*ClassObject)->TryGetArrayField(TEXT("functions"), FunctionsArray))
		{
			for (const TSharedPtr<FJsonValue>& FuncValue : *FunctionsArray)
			{
				const TSharedPtr<FJsonObject>* FuncObject = nullptr;
				if (FuncValue->TryGetObject(FuncObject))
				{
					ClassMetadata.Functions.Add(*FuncObject);
				}
			}
		}
		
		OutMetadata.Add(ClassMetadata);
	}
	
	return true;
}

FString UHTMetadataCache::GetCacheFilePath(const FString& ModuleName) const
{
	return FPaths::Combine(CacheDirectory, FString::Printf(TEXT("%s.json"), *ModuleName));
}

bool UHTMetadataCache::IsCacheValid(const FString& ModuleName) const
{
	// Check if cache file exists and is recent (within last hour)
	FString CacheFile = GetCacheFilePath(ModuleName);
	
	if (!FPaths::FileExists(CacheFile))
	{
		return false;
	}
	
	// Get file modification time
	FFileStatData StatData = IFileManager::Get().GetStatData(*CacheFile);
	if (!StatData.bIsValid)
	{
		return false;
	}
	
	// Consider cache valid if modified within last hour
	double CurrentTime = FPlatformTime::Seconds();
	double FileTime = StatData.ModificationTime.ToUnixTimestamp();
	double Age = CurrentTime - FileTime;
	
	// 1 hour = 3600 seconds
	return Age < 3600.0;
}

