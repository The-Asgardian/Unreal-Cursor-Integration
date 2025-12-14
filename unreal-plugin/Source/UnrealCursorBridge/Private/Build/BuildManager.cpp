// Copyright Epic Games, Inc. All Rights Reserved.

#include "Build/BuildManager.h"
#include "IPC/IPCServer.h"
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "Misc/App.h"
#include "HAL/PlatformFilemanager.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonSerializer.h"
#include "HAL/RunnableThread.h"
#include "Internationalization/Regex.h"
#include "HAL/PlatformProcess.h"
#include "HAL/ThreadSafeBool.h"
#include "Misc/Guid.h"
#include "HAL/Runnable.h"
#include "Misc/CString.h"
#include "Dom/JsonValue.h"

BuildManager& BuildManager::Get()
{
	static BuildManager Instance;
	return Instance;
}

FString BuildManager::StartBuild(const FString& Target, const FString& Configuration, const FString& Platform, const FString& ProjectPath, const TArray<FString>& ExtraArgs)
{
	FScopeLock Lock(&BuildsLock);
	
	if (bBuildInProgress)
	{
		UE_LOG(LogTemp, Warning, TEXT("Build already in progress"));
		return FString();
	}
	
	// Generate build ID
	FString BuildId = FGuid::NewGuid().ToString();
	
	// Create build info
	FBuildInfo BuildInfo;
	BuildInfo.BuildId = BuildId;
	BuildInfo.Target = Target;
	BuildInfo.Configuration = Configuration;
	BuildInfo.Platform = Platform;
	BuildInfo.ProjectPath = ProjectPath;
	BuildInfo.ExtraArgs = ExtraArgs;
	BuildInfo.bShouldCancel = new FThreadSafeBool(false);
	BuildInfo.StartTime = FPlatformTime::Seconds();
	
	ActiveBuilds.Add(BuildId, BuildInfo);
	CurrentBuildId = BuildId;
	bBuildInProgress = true;
	
	// Create and start build thread
	TSharedPtr<FBuildThread> BuildThread = MakeShareable(new FBuildThread(&ActiveBuilds[BuildId], this));
	BuildThreads.Add(BuildId, BuildThread);
	
	FRunnableThread* Thread = FRunnableThread::Create(BuildThread.Get(), *FString::Printf(TEXT("BuildThread_%s"), *BuildId));
	if (Thread)
	{
		Thread->SetThreadPriority(EThreadPriority::TPri_Normal);
	}
	
	// Send build started event
	TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
	EventData->SetStringField(TEXT("buildId"), BuildId);
	EventData->SetStringField(TEXT("target"), Target);
	EventData->SetStringField(TEXT("configuration"), Configuration);
	EventData->SetStringField(TEXT("platform"), Platform);
	SendBuildEvent(TEXT("build.started"), EventData, BuildId);
	
	return BuildId;
}

void BuildManager::CancelBuild(const FString& BuildId)
{
	FScopeLock Lock(&BuildsLock);
	
	FBuildInfo* BuildInfo = ActiveBuilds.Find(BuildId);
	if (BuildInfo)
	{
		*BuildInfo->bShouldCancel = true;
		
		// Kill process if still running
		if (BuildInfo->ProcessHandle.IsValid())
		{
			FPlatformProcess::TerminateProc(BuildInfo->ProcessHandle, true);
		}
		
		// Send cancellation event
		TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
		EventData->SetStringField(TEXT("buildId"), BuildId);
		SendBuildEvent(TEXT("build.cancelled"), EventData, BuildId);
	}
}

TArray<FString> BuildManager::GetAvailableTargets() const
{
	TArray<FString> Targets;
	Targets.Add(TEXT("Editor"));
	Targets.Add(TEXT("Game"));
	return Targets;
}

TArray<FString> BuildManager::GetAvailableConfigurations() const
{
	TArray<FString> Configs;
	Configs.Add(TEXT("Debug"));
	Configs.Add(TEXT("DebugGame"));
	Configs.Add(TEXT("Development"));
	Configs.Add(TEXT("Shipping"));
	Configs.Add(TEXT("Test"));
	return Configs;
}

TArray<FString> BuildManager::GetAvailablePlatforms() const
{
	TArray<FString> Platforms;
	Platforms.Add(TEXT("Win64"));
	#if PLATFORM_MAC
	Platforms.Add(TEXT("Mac"));
	#endif
	#if PLATFORM_LINUX
	Platforms.Add(TEXT("Linux"));
	#endif
	return Platforms;
}

bool BuildManager::IsBuildInProgress() const
{
	return bBuildInProgress;
}

FString BuildManager::GetCurrentBuildId() const
{
	return CurrentBuildId;
}

FString BuildManager::FindUnrealBuildTool() const
{
	FString EngineDir = FPaths::EngineDir();
	
	#if PLATFORM_WINDOWS
	// Try installed engine first
	FString InstalledUBT = FPaths::Combine(EngineDir, TEXT("Binaries"), TEXT("DotNET"), TEXT("UnrealBuildTool"), TEXT("UnrealBuildTool.exe"));
	if (FPaths::FileExists(InstalledUBT))
	{
		return InstalledUBT;
	}
	
	// Try source engine
	FString SourceUBT = FPaths::Combine(EngineDir, TEXT("Binaries"), TEXT("DotNET"), TEXT("UnrealBuildTool.exe"));
	if (FPaths::FileExists(SourceUBT))
	{
		return SourceUBT;
	}
	#elif PLATFORM_MAC || PLATFORM_LINUX
	FString UBT = FPaths::Combine(EngineDir, TEXT("Binaries"), TEXT("DotNET"), TEXT("UnrealBuildTool"), TEXT("UnrealBuildTool"));
	if (FPaths::FileExists(UBT))
	{
		return UBT;
	}
	#endif
	
	UE_LOG(LogTemp, Error, TEXT("Could not find UnrealBuildTool"));
	return FString();
}

FString BuildManager::BuildCommandLine(const FBuildInfo& BuildInfo) const
{
	FString CommandLine = FString::Printf(
		TEXT("%s %s %s %s"),
		*BuildInfo.Target,
		*BuildInfo.Platform,
		*BuildInfo.Configuration,
		*BuildInfo.ProjectPath
	);
	
	for (const FString& Arg : BuildInfo.ExtraArgs)
	{
		CommandLine += TEXT(" ") + Arg;
	}
	
	return CommandLine;
}

void BuildManager::ProcessBuildOutput(const FString& Line, const FString& BuildId)
{
	// Send output line event
	TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
	EventData->SetStringField(TEXT("buildId"), BuildId);
	EventData->SetStringField(TEXT("line"), Line);
	
	// Determine category
	FString Category = TEXT("Output");
	if (Line.Contains(TEXT("Error:")) || Line.Contains(TEXT("error")))
	{
		Category = TEXT("Error");
	}
	else if (Line.Contains(TEXT("Warning:")) || Line.Contains(TEXT("warning")))
	{
		Category = TEXT("Warning");
	}
	
	EventData->SetStringField(TEXT("category"), Category);
	SendBuildEvent(TEXT("build.outputLine"), EventData, BuildId);
	
	// Try to parse as diagnostic
	ParseDiagnostic(Line, BuildId);
}

void BuildManager::ParseDiagnostic(const FString& Line, const FString& BuildId)
{
	// UBT error format: "Path/To/File.cpp(123): error C1234: message"
	// Or: "Path/To/File.cpp:123:5: error: message"
	
	FString Pattern = TEXT("([^(]+)\\((\\d+)\\)\\s*:\\s*(error|warning)\\s+(.+)$");
	FRegexMatcher Matcher(FRegexPattern(Pattern), Line);
	
	if (Matcher.FindNext())
	{
		FString FilePath = Matcher.GetCaptureGroup(1).TrimStartAndEnd();
		FString LineNumber = Matcher.GetCaptureGroup(2);
		FString Severity = Matcher.GetCaptureGroup(3);
		FString Message = Matcher.GetCaptureGroup(4);
		
		// Convert to absolute path if relative
		if (FPaths::IsRelative(FilePath))
		{
			FString ProjectDir = FPaths::GetPath(FPaths::GetProjectFilePath());
			FilePath = FPaths::Combine(ProjectDir, FilePath);
			FilePath = FPaths::ConvertRelativePathToFull(FilePath);
		}
		
		TSharedPtr<FJsonObject> DiagnosticData = MakeShareable(new FJsonObject);
		DiagnosticData->SetStringField(TEXT("buildId"), BuildId);
		DiagnosticData->SetStringField(TEXT("file"), FilePath);
		DiagnosticData->SetNumberField(TEXT("line"), FCString::Atoi(*LineNumber));
		DiagnosticData->SetNumberField(TEXT("column"), 1);
		DiagnosticData->SetStringField(TEXT("severity"), Severity);
		DiagnosticData->SetStringField(TEXT("message"), Message);
		
		SendBuildEvent(TEXT("build.diagnostic"), DiagnosticData, BuildId);
	}
}

void BuildManager::SendBuildEvent(const FString& EventName, const TSharedPtr<FJsonObject>& EventData, const FString& BuildId)
{
	IPCServer::Get().SendEvent(EventName, EventData);
}

// BuildThread implementation
BuildManager::FBuildThread::FBuildThread(FBuildInfo* InBuildInfo, BuildManager* InManager)
	: BuildInfo(InBuildInfo)
	, Manager(InManager)
	, bShouldStop(false)
{
}

BuildManager::FBuildThread::~FBuildThread()
{
}

bool BuildManager::FBuildThread::Init()
{
	return true;
}

uint32 BuildManager::FBuildThread::Run()
{
	FString UBT = Manager->FindUnrealBuildTool();
	if (UBT.IsEmpty())
	{
		// Send error event
		TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
		EventData->SetStringField(TEXT("buildId"), BuildInfo->BuildId);
		EventData->SetBoolField(TEXT("success"), false);
		EventData->SetStringField(TEXT("error"), TEXT("UnrealBuildTool not found"));
		Manager->SendBuildEvent(TEXT("build.finished"), EventData, BuildInfo->BuildId);
		
		FScopeLock Lock(&Manager->BuildsLock);
		Manager->ActiveBuilds.Remove(BuildInfo->BuildId);
		Manager->BuildThreads.Remove(BuildInfo->BuildId);
		Manager->bBuildInProgress = false;
		Manager->CurrentBuildId.Empty();
		return 1;
	}
	
	FString CommandLine = Manager->BuildCommandLine(*BuildInfo);
	
	UE_LOG(LogTemp, Log, TEXT("Starting build: %s %s"), *UBT, *CommandLine);
	
	// Create process
	uint32 ProcessId = 0;
	void* ReadPipe = nullptr;
	void* WritePipe = nullptr;
	
	FPlatformProcess::CreatePipe(ReadPipe, WritePipe);
	
	FProcHandle ProcessHandle = FPlatformProcess::CreateProc(
		*UBT,
		*CommandLine,
		false,
		true,
		true,
		&ProcessId,
		0,
		nullptr,
		WritePipe,
		ReadPipe
	);
	
	BuildInfo->ProcessHandle = ProcessHandle;
	
	if (!ProcessHandle.IsValid())
	{
		UE_LOG(LogTemp, Error, TEXT("Failed to start build process"));
		
		TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
		EventData->SetStringField(TEXT("buildId"), BuildInfo->BuildId);
		EventData->SetBoolField(TEXT("success"), false);
		EventData->SetStringField(TEXT("error"), TEXT("Failed to start build process"));
		Manager->SendBuildEvent(TEXT("build.finished"), EventData, BuildInfo->BuildId);
		
		FScopeLock Lock(&Manager->BuildsLock);
		Manager->ActiveBuilds.Remove(BuildInfo->BuildId);
		Manager->BuildThreads.Remove(BuildInfo->BuildId);
		Manager->bBuildInProgress = false;
		Manager->CurrentBuildId.Empty();
		
		FPlatformProcess::ClosePipe(ReadPipe, WritePipe);
		return 1;
	}
	
	// Read output
	FString Output;
	while (FPlatformProcess::IsProcRunning(ProcessHandle) && !bShouldStop && !*BuildInfo->bShouldCancel)
	{
		FString NewOutput = FPlatformProcess::ReadPipe(ReadPipe);
		if (!NewOutput.IsEmpty())
		{
			Output += NewOutput;
			
			// Process line by line
			TArray<FString> Lines;
			NewOutput.ParseIntoArrayLines(Lines);
			for (const FString& Line : Lines)
			{
				if (!Line.IsEmpty())
				{
					Manager->ProcessBuildOutput(Line, BuildInfo->BuildId);
				}
			}
		}
		
		FPlatformProcess::Sleep(0.1f);
	}
	
	// Get exit code
	int32 ReturnCode = 0;
	FPlatformProcess::GetProcReturnCode(ProcessHandle, &ReturnCode);
	
	bool bSuccess = (ReturnCode == 0) && !*BuildInfo->bShouldCancel;
	
	// Send finished event
	double Duration = FPlatformTime::Seconds() - BuildInfo->StartTime;
	TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
	EventData->SetStringField(TEXT("buildId"), BuildInfo->BuildId);
	EventData->SetBoolField(TEXT("success"), bSuccess);
	EventData->SetNumberField(TEXT("duration"), Duration);
	if (!bSuccess && *BuildInfo->bShouldCancel)
	{
		EventData->SetStringField(TEXT("error"), TEXT("Build cancelled"));
	}
	Manager->SendBuildEvent(TEXT("build.finished"), EventData, BuildInfo->BuildId);
	
	// Cleanup
	FPlatformProcess::CloseProc(ProcessHandle);
	FPlatformProcess::ClosePipe(ReadPipe, WritePipe);
	
	FScopeLock Lock(&Manager->BuildsLock);
	Manager->ActiveBuilds.Remove(BuildInfo->BuildId);
	Manager->BuildThreads.Remove(BuildInfo->BuildId);
	Manager->bBuildInProgress = false;
	Manager->CurrentBuildId.Empty();
	
	delete BuildInfo->bShouldCancel;
	
	return 0;
}

void BuildManager::FBuildThread::Exit()
{
}

void BuildManager::FBuildThread::Cancel()
{
	bShouldStop = true;
}
