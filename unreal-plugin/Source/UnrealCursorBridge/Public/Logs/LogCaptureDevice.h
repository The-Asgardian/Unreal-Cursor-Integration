// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Misc/OutputDevice.h"

// Real-time Logging - Captures all Unreal Engine logs
class FLogCaptureDevice : public FOutputDevice
{
public:
	FLogCaptureDevice();
	virtual ~FLogCaptureDevice();
	
	virtual void Serialize(const TCHAR* V, ELogVerbosity::Type Verbosity, const FName& Category) override;
	
	void Subscribe(const TArray<FString>& Categories, const FString& Verbosity, const FString& Search);
	void Unsubscribe();
	
	static FLogCaptureDevice& Get();

private:
	FString GetVerbosityString(ELogVerbosity::Type Verbosity) const;
	bool ShouldIncludeVerbosity(ELogVerbosity::Type CurrentVerbosity, const FString& FilterVerbosityStr) const;

	TArray<FString> SubscribedCategories;
	FString FilterVerbosity;
	FString SearchFilter;
	bool bIsSubscribed;
};

