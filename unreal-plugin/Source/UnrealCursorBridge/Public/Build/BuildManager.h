// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "HAL/Runnable.h"
#include "HAL/ThreadSafeBool.h"
#include "HAL/PlatformProcess.h"
#include "Containers/Map.h"
#include "Misc/Guid.h"

class IPCServer;

struct FBuildInfo
{
	FString BuildId;
	FString Target;
	FString Configuration;
	FString Platform;
	FString ProjectPath;
	TArray<FString> ExtraArgs;
	FProcHandle ProcessHandle;
	FThreadSafeBool* bShouldCancel;
	double StartTime;
};

class BuildManager
{
public:
	static BuildManager& Get();
	
	// Start a build operation
	FString StartBuild(const FString& Target, const FString& Configuration, const FString& Platform, const FString& ProjectPath, const TArray<FString>& ExtraArgs);
	
	// Cancel a build operation
	void CancelBuild(const FString& BuildId);
	
	// List available build targets
	TArray<FString> GetAvailableTargets() const;
	TArray<FString> GetAvailableConfigurations() const;
	TArray<FString> GetAvailablePlatforms() const;
	
	bool IsBuildInProgress() const;
	FString GetCurrentBuildId() const;

private:
	BuildManager() = default;
	~BuildManager() = default;
	
	// Find UnrealBuildTool executable
	FString FindUnrealBuildTool() const;
	
	// Build UBT command line arguments
	FString BuildCommandLine(const FBuildInfo& BuildInfo) const;
	
	// Process build output line
	void ProcessBuildOutput(const FString& Line, const FString& BuildId);
	
	// Parse diagnostic from build output
	void ParseDiagnostic(const FString& Line, const FString& BuildId);
	
	// Send build event
	void SendBuildEvent(const FString& EventName, const TSharedPtr<FJsonObject>& EventData, const FString& BuildId);
	
	// Background thread for build execution
	class FBuildThread : public FRunnable
	{
	public:
		FBuildThread(FBuildInfo* InBuildInfo, BuildManager* InManager);
		virtual ~FBuildThread();
		
		virtual bool Init() override;
		virtual uint32 Run() override;
		virtual void Exit() override;
		
		void Cancel();
		
	private:
		FBuildInfo* BuildInfo;
		BuildManager* Manager;
		FThreadSafeBool bShouldStop;
	};
	
	FThreadSafeBool bBuildInProgress;
	FString CurrentBuildId;
	TMap<FString, FBuildInfo> ActiveBuilds;
	TMap<FString, TSharedPtr<FBuildThread>> BuildThreads;
	
	mutable FCriticalSection BuildsLock;
};
