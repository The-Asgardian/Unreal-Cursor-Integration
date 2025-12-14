// Copyright Epic Games, Inc. All Rights Reserved.

#include "Logs/LogCaptureDevice.h"
#include "IPC/IPCServer.h"
#include "Dom/JsonObject.h"
#include "Misc/DateTime.h"

FLogCaptureDevice::FLogCaptureDevice()
{
}

FLogCaptureDevice::~FLogCaptureDevice()
{
}

void FLogCaptureDevice::Serialize(const TCHAR* V, ELogVerbosity::Type Verbosity, const FName& Category)
{
	// Phase 4: Implement log capture and filtering
	// This will emit logs.line events via IPCServer
}

void FLogCaptureDevice::Subscribe(const TArray<FString>& Categories, const FString& Verbosity, const FString& Search)
{
	SubscribedCategories = Categories;
	FilterVerbosity = Verbosity;
	SearchFilter = Search;
}

void FLogCaptureDevice::Unsubscribe()
{
	SubscribedCategories.Empty();
	FilterVerbosity.Empty();
	SearchFilter.Empty();
}

