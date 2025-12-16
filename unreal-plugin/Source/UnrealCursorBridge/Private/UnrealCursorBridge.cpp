// Copyright Epic Games, Inc. All Rights Reserved.

#include "UnrealCursorBridge.h"
#include "IPC/IPCServer.h"
#include "IPC/MessageHandler.h"
#include "Logs/LogCaptureDevice.h"
#include "LiveCoding/LiveCodingManager.h"
#include "Reflection/ReflectionQueryManager.h"
#include "Modules/ModuleManager.h"
#include "ISettingsModule.h"
#include "ISettingsSection.h"
#include "Settings/UnrealCursorBridgeSettings.h"

#define LOCTEXT_NAMESPACE "FUnrealCursorBridgeModule"

void FUnrealCursorBridgeModule::StartupModule()
{
	// Initialize log capture device (singleton)
	FLogCaptureDevice::Get();
	
	// Initialize reflection cache system (loads from disk or builds asynchronously)
	UE_LOG(LogTemp, Log, TEXT("[UnrealCursorBridge] Initializing reflection cache system"));
	ReflectionQueryManager::Get().InitializeCache();
	
	// Register message handlers
	MessageHandler::RegisterHandlers();
	
	// Register settings
	RegisterSettings();
	
	// Load settings and apply
	UUnrealCursorBridgeSettings* Settings = UUnrealCursorBridgeSettings::Get();
	Settings->LoadSettings();
	
	// Enable Live Coding based on settings
	#if WITH_LIVE_CODING
	LiveCodingManager::Get().SetEnabled(Settings->bEnableLiveCoding);
	#endif
	
	// Start IPC server if enabled
	if (Settings->bEnableIPCServer && Settings->bAutoStartServer)
	{
		IPCServer::Get().Start();
	}
}

void FUnrealCursorBridgeModule::ShutdownModule()
{
	// Stop IPC server on shutdown
	IPCServer::Get().Stop();
	
	// Unregister settings
	UnregisterSettings();
}

void FUnrealCursorBridgeModule::RegisterSettings()
{
	if (ISettingsModule* SettingsModule = FModuleManager::GetModulePtr<ISettingsModule>("Settings"))
	{
		ISettingsSectionPtr SettingsSection = SettingsModule->RegisterSettings("Editor", "Plugins", "UnrealCursorBridge",
			LOCTEXT("UnrealCursorBridgeSettingsName", "Unreal Cursor Bridge"),
			LOCTEXT("UnrealCursorBridgeSettingsDescription", "Configure the Unreal Cursor Bridge plugin settings"),
			GetMutableDefault<UUnrealCursorBridgeSettings>());
		
		if (SettingsSection.IsValid())
		{
			SettingsSection->OnModified().BindRaw(this, &FUnrealCursorBridgeModule::HandleSettingsSaved);
		}
	}
}

void FUnrealCursorBridgeModule::UnregisterSettings()
{
	if (ISettingsModule* SettingsModule = FModuleManager::GetModulePtr<ISettingsModule>("Settings"))
	{
		SettingsModule->UnregisterSettings("Editor", "Plugins", "UnrealCursorBridge");
	}
}

bool FUnrealCursorBridgeModule::HandleSettingsSaved()
{
	UUnrealCursorBridgeSettings* Settings = UUnrealCursorBridgeSettings::Get();
	Settings->SaveSettings();
	
	// Apply settings
	#if WITH_LIVE_CODING
	LiveCodingManager::Get().SetEnabled(Settings->bEnableLiveCoding);
	#endif
	
	// Restart IPC server if needed
	if (Settings->bEnableIPCServer && Settings->bAutoStartServer)
	{
		IPCServer::Get().Stop();
		IPCServer::Get().Start();
	}
	else if (!Settings->bEnableIPCServer)
	{
		IPCServer::Get().Stop();
	}
	
	return true;
}

#undef LOCTEXT_NAMESPACE
	
IMPLEMENT_MODULE(FUnrealCursorBridgeModule, UnrealCursorBridge)
