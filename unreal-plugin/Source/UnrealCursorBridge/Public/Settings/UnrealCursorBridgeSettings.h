// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "UObject/NoExportTypes.h"
#include "UnrealCursorBridgeSettings.generated.h"

/**
 * Settings for the Unreal Cursor Bridge plugin
 */
UCLASS(config = EditorPerProjectUserSettings)
class UNREALCURSORBRIDGE_API UUnrealCursorBridgeSettings : public UObject
{
	GENERATED_BODY()

public:
	UUnrealCursorBridgeSettings(const FObjectInitializer& ObjectInitializer);

	/** WebSocket server port for Cursor/VS Code connection (default: 17777) */
	UPROPERTY(config, EditAnywhere, Category = "IPC Server", meta = (ClampMin = "1024", ClampMax = "65535", ToolTip = "Port number for the WebSocket server that communicates with Cursor/VS Code extension"))
	int32 ServerPort;

	/** Enable/disable the IPC server. When disabled, the extension cannot connect. */
	UPROPERTY(config, EditAnywhere, Category = "IPC Server", meta = (ToolTip = "Enable or disable the IPC WebSocket server"))
	bool bEnableIPCServer;

	/** Automatically start the IPC server when the editor launches */
	UPROPERTY(config, EditAnywhere, Category = "IPC Server", meta = (ToolTip = "If enabled, the server will start automatically when the editor opens"))
	bool bAutoStartServer;

	/** Enable/disable Live Coding support for hot-reloading C++ code */
	UPROPERTY(config, EditAnywhere, Category = "Live Coding", meta = (ToolTip = "Enable Live Coding support for hot-reloading C++ code without full rebuilds"))
	bool bEnableLiveCoding;

	/** Enable/disable log capture and streaming to Cursor/VS Code */
	UPROPERTY(config, EditAnywhere, Category = "Logging", meta = (ToolTip = "Capture and stream Unreal Engine logs to the Cursor/VS Code extension"))
	bool bEnableLogCapture;

	/** Filter logs by verbosity level (e.g., Log, Warning, Error). Leave empty to show all. */
	UPROPERTY(config, EditAnywhere, Category = "Logging", meta = (ToolTip = "Filter logs by verbosity (Log, Warning, Error). Empty = all verbosities"))
	FString LogVerbosityFilter;

	/** Filter logs by category (e.g., LogTemp, LogEditor). Leave empty to show all. */
	UPROPERTY(config, EditAnywhere, Category = "Logging", meta = (ToolTip = "Filter logs by category (e.g., LogTemp, LogEditor). Empty = all categories"))
	FString LogCategoryFilter;

	/** Enable/disable build system integration (UBT invocation, diagnostics, etc.) */
	UPROPERTY(config, EditAnywhere, Category = "Build System", meta = (ToolTip = "Enable build system integration for building targets from Cursor/VS Code"))
	bool bEnableBuildSystem;

	/** Enable/disable asset operations (create, rename, delete assets) */
	UPROPERTY(config, EditAnywhere, Category = "Asset Management", meta = (ToolTip = "Enable asset management operations (create, rename, delete assets)"))
	bool bEnableAssetOperations;

	/** Enable/disable profiling support (CPU/GPU stats, Unreal Insights) */
	UPROPERTY(config, EditAnywhere, Category = "Profiling", meta = (ToolTip = "Enable performance profiling support"))
	bool bEnableProfiling;

	/** Show connection status indicators in the editor UI */
	UPROPERTY(config, EditAnywhere, Category = "UI", meta = (ToolTip = "Display connection status indicators in the editor"))
	bool bShowConnectionStatus;

	/** Get the settings instance */
	static UUnrealCursorBridgeSettings* Get();

	/** Save settings to config file */
	void SaveSettings();

	/** Load settings from config file */
	void LoadSettings();
};

