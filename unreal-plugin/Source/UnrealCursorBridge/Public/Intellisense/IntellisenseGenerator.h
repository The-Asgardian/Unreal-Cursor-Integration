// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "HAL/Runnable.h"
#include "HAL/PlatformProcess.h"
#include "HAL/ThreadSafeBool.h"
#include "Containers/Map.h"
#include "Misc/Guid.h"

class IPCServer;

// Phase 5: UHT + IntelliSense
class IntellisenseGenerator
{
public:
	static IntellisenseGenerator& Get();
	
	// Generate compile_commands.json for clangd/IntelliSense
	// Returns a job ID for tracking progress
	FString GenerateCompileCommands(const FString& Target = TEXT("Editor"), const FString& Platform = TEXT("Win64"), const FString& Configuration = TEXT("Development"));
	
	// Cancel a running generation job
	void CancelGeneration(const FString& JobId);
	
	// Run UHT check and return diagnostics
	FString RunUHTCheck();
	
	// Check if generation is in progress
	bool IsGenerationInProgress() const;
	
	// Get current job ID
	FString GetCurrentJobId() const;

private:
	IntellisenseGenerator() = default;
	~IntellisenseGenerator();
	
	// Find UnrealBuildTool executable
	FString FindUnrealBuildTool() const;
	
	// Build command line for GenerateClangDatabase
	FString BuildGenerateClangDatabaseCommandLine(const FString& Target, const FString& Platform, const FString& Configuration) const;
	
	// Build command line for UHT check
	FString BuildUHTCheckCommandLine() const;
	
	// Send generation event
	void SendGenerationEvent(const FString& EventName, const TSharedPtr<FJsonObject>& EventData, const FString& JobId);
	
	// Background thread for generation execution
	class FGenerationThread : public FRunnable
	{
	public:
		FGenerationThread(FString* InJobId, FString* InOutputPath, IntellisenseGenerator* InManager, const FString& InTarget, const FString& InPlatform, const FString& InConfiguration, bool bInIsUHTCheck);
		virtual ~FGenerationThread();
		
		virtual bool Init() override;
		virtual uint32 Run() override;
		virtual void Exit() override;
		
		void Cancel();
		
	private:
		FString* JobId;
		FString* OutputPath;
		IntellisenseGenerator* Manager;
		FString Target;
		FString Platform;
		FString Configuration;
		bool bIsUHTCheck;
		FThreadSafeBool bShouldStop;
	};
	
	FThreadSafeBool bGenerationInProgress;
	FString CurrentJobId;
	TMap<FString, TSharedPtr<FGenerationThread>> GenerationThreads;
	
	mutable FCriticalSection GenerationLock;
};

