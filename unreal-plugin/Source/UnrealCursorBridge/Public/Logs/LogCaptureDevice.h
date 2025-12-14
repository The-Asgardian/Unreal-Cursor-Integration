// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Misc/OutputDevice.h"

// Placeholder for Phase 4: Real-time Logging
class FLogCaptureDevice : public FOutputDevice
{
public:
	FLogCaptureDevice();
	virtual ~FLogCaptureDevice();
	
	virtual void Serialize(const TCHAR* V, ELogVerbosity::Type Verbosity, const FName& Category) override;
	
	void Subscribe(const TArray<FString>& Categories, const FString& Verbosity, const FString& Search);
	void Unsubscribe();

private:
	TArray<FString> SubscribedCategories;
	FString FilterVerbosity;
	FString SearchFilter;
};

