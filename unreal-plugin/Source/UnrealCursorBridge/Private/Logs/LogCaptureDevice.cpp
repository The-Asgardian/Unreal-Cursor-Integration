// Copyright Epic Games, Inc. All Rights Reserved.

#include "Logs/LogCaptureDevice.h"
#include "IPC/IPCServer.h"
#include "Dom/JsonObject.h"
#include "Misc/DateTime.h"
#include "HAL/PlatformProcess.h"
#include "Misc/OutputDeviceRedirector.h"
#include "Engine/Engine.h"

FLogCaptureDevice::FLogCaptureDevice()
	: bIsSubscribed(false)
{
	// Register with the output device redirector to capture all logs
	if (GLog)
	{
		GLog->AddOutputDevice(this);
	}
}

FLogCaptureDevice& FLogCaptureDevice::Get()
{
	static FLogCaptureDevice Instance;
	return Instance;
}

FLogCaptureDevice::~FLogCaptureDevice()
{
	// Unregister from output device redirector
	if (GLog)
	{
		GLog->RemoveOutputDevice(this);
	}
}

void FLogCaptureDevice::Serialize(const TCHAR* V, ELogVerbosity::Type Verbosity, const FName& Category)
{
	if (!bIsSubscribed)
	{
		return;
	}
	
	FString MessageStr = V;
	
	// CRITICAL: Prevent infinite recursion by filtering out IPC-related logs
	// These logs would create events that get logged again, causing infinite loop
	if (MessageStr.Contains(TEXT("Sending event")) || 
		MessageStr.Contains(TEXT("Sending response")) ||
		MessageStr.Contains(TEXT("Sending request")) ||
		MessageStr.Contains(TEXT("Received message")) ||
		MessageStr.Contains(TEXT("IPC")))
	{
		return;
	}
	
	// Apply filters
	if (!SubscribedCategories.IsEmpty())
	{
		FString CategoryStr = Category.ToString();
		bool bMatchesCategory = false;
		for (const FString& SubscribedCategory : SubscribedCategories)
		{
			if (CategoryStr.Contains(SubscribedCategory))
			{
				bMatchesCategory = true;
				break;
			}
		}
		if (!bMatchesCategory)
		{
			return;
		}
	}
	
	// Apply verbosity filter
	if (!FilterVerbosity.IsEmpty())
	{
		FString VerbosityStr = GetVerbosityString(Verbosity);
		if (VerbosityStr != FilterVerbosity && !ShouldIncludeVerbosity(Verbosity, FilterVerbosity))
		{
			return;
		}
	}
	
	// Apply search filter
	if (!SearchFilter.IsEmpty() && !MessageStr.Contains(SearchFilter))
	{
		return;
	}
	
	// Get current frame number (if available)
	int32 FrameNumber = 0;
	if (GEngine)
	{
		FrameNumber = GFrameNumber;
	}
	
	// Get timestamp
	FDateTime Now = FDateTime::Now();
	FString Timestamp = Now.ToString(TEXT("%Y-%m-%d %H:%M:%S"));
	
	// Get file and line if available (from call stack)
	FString File;
	int32 Line = 0;
	
	// Send log event via IPC
	TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
	EventData->SetStringField(TEXT("timestamp"), Timestamp);
	EventData->SetNumberField(TEXT("frame"), FrameNumber);
	EventData->SetStringField(TEXT("category"), Category.ToString());
	EventData->SetStringField(TEXT("verbosity"), GetVerbosityString(Verbosity));
	EventData->SetStringField(TEXT("message"), MessageStr);
	if (!File.IsEmpty())
	{
		EventData->SetStringField(TEXT("file"), File);
		EventData->SetNumberField(TEXT("line"), Line);
	}
	
	IPCServer::Get().SendEvent(TEXT("logs.line"), EventData);
}

void FLogCaptureDevice::Subscribe(const TArray<FString>& Categories, const FString& Verbosity, const FString& Search)
{
	SubscribedCategories = Categories;
	FilterVerbosity = Verbosity;
	SearchFilter = Search;
	bIsSubscribed = true;
}

void FLogCaptureDevice::Unsubscribe()
{
	SubscribedCategories.Empty();
	FilterVerbosity.Empty();
	SearchFilter.Empty();
	bIsSubscribed = false;
}

FString FLogCaptureDevice::GetVerbosityString(ELogVerbosity::Type Verbosity) const
{
	switch (Verbosity)
	{
		case ELogVerbosity::Fatal:
			return TEXT("Fatal");
		case ELogVerbosity::Error:
			return TEXT("Error");
		case ELogVerbosity::Warning:
			return TEXT("Warning");
		case ELogVerbosity::Display:
			return TEXT("Display");
		case ELogVerbosity::Log:
			return TEXT("Log");
		case ELogVerbosity::Verbose:
			return TEXT("Verbose");
		case ELogVerbosity::VeryVerbose:
			return TEXT("VeryVerbose");
		default:
			return TEXT("Log");
	}
}

bool FLogCaptureDevice::ShouldIncludeVerbosity(ELogVerbosity::Type CurrentVerbosity, const FString& FilterVerbosityStr) const
{
	// Check if current verbosity level should be included based on filter
	// Lower numeric value = higher priority
	if (FilterVerbosityStr == TEXT("Fatal"))
	{
		return CurrentVerbosity == ELogVerbosity::Fatal;
	}
	else if (FilterVerbosityStr == TEXT("Error"))
	{
		return CurrentVerbosity <= ELogVerbosity::Error;
	}
	else if (FilterVerbosityStr == TEXT("Warning"))
	{
		return CurrentVerbosity <= ELogVerbosity::Warning;
	}
	else if (FilterVerbosityStr == TEXT("Display"))
	{
		return CurrentVerbosity <= ELogVerbosity::Display;
	}
	else if (FilterVerbosityStr == TEXT("Log"))
	{
		return CurrentVerbosity <= ELogVerbosity::Log;
	}
	else if (FilterVerbosityStr == TEXT("Verbose"))
	{
		return CurrentVerbosity <= ELogVerbosity::Verbose;
	}
	else if (FilterVerbosityStr == TEXT("VeryVerbose"))
	{
		return CurrentVerbosity <= ELogVerbosity::VeryVerbose;
	}
	
	// Default: include all
	return true;
}
