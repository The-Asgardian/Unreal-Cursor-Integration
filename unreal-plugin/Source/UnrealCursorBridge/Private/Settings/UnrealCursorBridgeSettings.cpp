// Copyright Epic Games, Inc. All Rights Reserved.

#include "Settings/UnrealCursorBridgeSettings.h"
#include "Misc/ConfigCacheIni.h"

UUnrealCursorBridgeSettings::UUnrealCursorBridgeSettings(const FObjectInitializer& ObjectInitializer)
	: Super(ObjectInitializer)
	, ServerPort(17777)
	, bEnableIPCServer(true)
	, bAutoStartServer(true)
	, bEnableLiveCoding(true)
	, bEnableLogCapture(true)
	, LogVerbosityFilter(TEXT(""))
	, LogCategoryFilter(TEXT(""))
	, bEnableBuildSystem(true)
	, bEnableAssetOperations(true)
	, bEnableProfiling(true)
	, bShowConnectionStatus(true)
{
}

UUnrealCursorBridgeSettings* UUnrealCursorBridgeSettings::Get()
{
	static UUnrealCursorBridgeSettings* Settings = nullptr;
	if (!Settings)
	{
		Settings = NewObject<UUnrealCursorBridgeSettings>();
		Settings->LoadSettings();
	}
	return Settings;
}

void UUnrealCursorBridgeSettings::SaveSettings()
{
	SaveConfig(CPF_Config, *GetDefaultConfigFilename());
}

void UUnrealCursorBridgeSettings::LoadSettings()
{
	LoadConfig(GetClass(), *GetDefaultConfigFilename());
}

