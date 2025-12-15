// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

class FUnrealCursorBridgeModule : public IModuleInterface
{
public:

	/** IModuleInterface implementation */
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

private:
	/** Register settings in the editor */
	void RegisterSettings();

	/** Unregister settings */
	void UnregisterSettings();

	/** Handle settings being saved */
	bool HandleSettingsSaved();
};

