// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Misc/FileHelper.h"
#include "HAL/PlatformFilemanager.h"

struct FUHTClassMetadata
{
	FString Name;
	FString Super;
	FString Module;
	TMap<FString, FString> Metadata;
	TArray<TSharedPtr<FJsonObject>> Properties;
	TArray<TSharedPtr<FJsonObject>> Functions;
};

class UHTMetadataExtractor
{
public:
	static UHTMetadataExtractor& Get();
	
	// Extract metadata from UHT-generated header file
	bool ExtractFromGeneratedHeader(const FString& GeneratedHeaderPath, FUHTClassMetadata& OutMetadata);
	
	// Extract metadata from all generated headers in a module
	TArray<FUHTClassMetadata> ExtractFromModule(const FString& ModuleName);
	
	// Parse a single generated header file
	bool ParseGeneratedHeader(const FString& FilePath, FUHTClassMetadata& OutMetadata);

private:
	UHTMetadataExtractor() = default;
	~UHTMetadataExtractor() = default;
	
	// Helper functions for parsing
	bool ParseClassDeclaration(const FString& Line, FUHTClassMetadata& OutMetadata);
	bool ParsePropertyDeclaration(const FString& Line, TSharedPtr<FJsonObject>& OutProperty);
	bool ParseFunctionDeclaration(const FString& Line, TSharedPtr<FJsonObject>& OutFunction);
	TMap<FString, FString> ParseMetadata(const FString& MetadataString);
	TArray<FString> ParseFlags(const FString& FlagsString);
	
	// Find generated headers for a module
	TArray<FString> FindGeneratedHeaders(const FString& ModuleName);
};

