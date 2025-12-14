// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"

// Placeholder for Phase 6: Blueprint + Asset CRUD
class AssetOperations
{
public:
	static AssetOperations& Get();
	
	TArray<FString> ListAssets(const FString& Path, const FString& ClassFilter, bool bRecursive);
	FString CreateAsset(const FString& AssetType, const FString& Name, const FString& Path, const TSharedPtr<FJsonObject>& Params);
	void RenameAsset(const FString& ObjectPath, const FString& NewName, const FString& NewPath);
	void DeleteAssets(const TArray<FString>& ObjectPaths);
	void OpenAssetInEditor(const FString& ObjectPath);

private:
	AssetOperations() = default;
	~AssetOperations() = default;
};

