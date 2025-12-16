// Copyright Epic Games, Inc. All Rights Reserved.

#include "Intellisense/IntellisenseGenerator.h"
#include "IPC/IPCServer.h"
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "HAL/PlatformFilemanager.h"
#include "HAL/PlatformProcess.h"
#include "HAL/RunnableThread.h"
#include "Dom/JsonObject.h"
#include "Misc/App.h"
#include "Misc/CString.h"

IntellisenseGenerator& IntellisenseGenerator::Get()
{
	static IntellisenseGenerator Instance;
	return Instance;
}

IntellisenseGenerator::~IntellisenseGenerator()
{
	// Cancel all running threads
	FScopeLock Lock(&GenerationLock);
	for (auto& Pair : GenerationThreads)
	{
		if (Pair.Value.IsValid())
		{
			Pair.Value->Cancel();
		}
	}
	GenerationThreads.Empty();
}

FString IntellisenseGenerator::FindUnrealBuildTool() const
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

FString IntellisenseGenerator::BuildGenerateClangDatabaseCommandLine(const FString& Target, const FString& Platform, const FString& Configuration) const
{
	FString ProjectPath = FPaths::GetProjectFilePath();
	
	// UBT command line format for GenerateClangDatabase:
	// -Mode=GenerateClangDatabase -Project="ProjectPath" -Target="Target" -Platform="Platform" -Configuration="Configuration"
	FString CommandLine = FString::Printf(
		TEXT("-Mode=GenerateClangDatabase -Project=\"%s\" -Target=\"%s\" -Platform=\"%s\" -Configuration=\"%s\""),
		*ProjectPath,
		*Target,
		*Platform,
		*Configuration
	);
	
	return CommandLine;
}

FString IntellisenseGenerator::BuildUHTCheckCommandLine() const
{
	FString ProjectPath = FPaths::GetProjectFilePath();
	
	// UHT check via UBT - run a validation build that checks UHT without full compilation
	// Using -SkipPreBuildTargets and -SkipBuild to only run UHT validation
	FString CommandLine = FString::Printf(
		TEXT("-Mode=GenerateClangDatabase -Project=\"%s\" -Target=\"Editor\" -Platform=\"Win64\" -Configuration=\"Development\" -UBTArgs=\"-SkipPreBuildTargets -SkipBuild -CheckUHT\""),
		*ProjectPath
	);
	
	return CommandLine;
}

void IntellisenseGenerator::SendGenerationEvent(const FString& EventName, const TSharedPtr<FJsonObject>& EventData, const FString& JobId)
{
	IPCServer::Get().SendEvent(EventName, EventData);
}

FString IntellisenseGenerator::GenerateCompileCommands(const FString& Target, const FString& Platform, const FString& Configuration)
{
	FScopeLock Lock(&GenerationLock);
	
	if (bGenerationInProgress)
	{
		UE_LOG(LogTemp, Warning, TEXT("Generation already in progress"));
		return FString();
	}
	
	// Generate job ID
	FString JobId = FGuid::NewGuid().ToString();
	CurrentJobId = JobId;
	bGenerationInProgress = true;
	
	// Create output path holder
	FString* OutputPath = new FString();
	
	// Create and start generation thread
	TSharedPtr<FGenerationThread> GenerationThread = MakeShareable(new FGenerationThread(
		&CurrentJobId,
		OutputPath,
		this,
		Target,
		Platform,
		Configuration,
		false // Not UHT check
	));
	GenerationThreads.Add(JobId, GenerationThread);
	
	FRunnableThread* Thread = FRunnableThread::Create(GenerationThread.Get(), *FString::Printf(TEXT("IntellisenseGenThread_%s"), *JobId));
	if (Thread)
	{
		Thread->SetThreadPriority(EThreadPriority::TPri_Normal);
	}
	
	// Send generation started event
	TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
	EventData->SetStringField(TEXT("jobId"), JobId);
	EventData->SetStringField(TEXT("target"), Target);
	EventData->SetStringField(TEXT("platform"), Platform);
	EventData->SetStringField(TEXT("configuration"), Configuration);
	SendGenerationEvent(TEXT("intellisense.generationStarted"), EventData, JobId);
	
	return JobId;
}

FString IntellisenseGenerator::RunUHTCheck()
{
	FScopeLock Lock(&GenerationLock);
	
	if (bGenerationInProgress)
	{
		UE_LOG(LogTemp, Warning, TEXT("Generation already in progress"));
		return FString();
	}
	
	// Generate job ID
	FString JobId = FGuid::NewGuid().ToString();
	CurrentJobId = JobId;
	bGenerationInProgress = true;
	
	// Create output path holder (for diagnostics)
	FString* OutputPath = new FString();
	
	// Create and start generation thread
	TSharedPtr<FGenerationThread> GenerationThread = MakeShareable(new FGenerationThread(
		&CurrentJobId,
		OutputPath,
		this,
		TEXT("Editor"),
		TEXT("Win64"),
		TEXT("Development"),
		true // UHT check
	));
	GenerationThreads.Add(JobId, GenerationThread);
	
	FRunnableThread* Thread = FRunnableThread::Create(GenerationThread.Get(), *FString::Printf(TEXT("UHTCheckThread_%s"), *JobId));
	if (Thread)
	{
		Thread->SetThreadPriority(EThreadPriority::TPri_Normal);
	}
	
	// Send UHT check started event
	TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
	EventData->SetStringField(TEXT("jobId"), JobId);
	SendGenerationEvent(TEXT("intellisense.uhtCheckStarted"), EventData, JobId);
	
	return JobId;
}

void IntellisenseGenerator::CancelGeneration(const FString& JobId)
{
	FScopeLock Lock(&GenerationLock);
	
	TSharedPtr<FGenerationThread>* ThreadPtr = GenerationThreads.Find(JobId);
	if (ThreadPtr && ThreadPtr->IsValid())
	{
		(*ThreadPtr)->Cancel();
		
		// Send cancellation event
		TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
		EventData->SetStringField(TEXT("jobId"), JobId);
		SendGenerationEvent(TEXT("intellisense.generationCancelled"), EventData, JobId);
	}
}

bool IntellisenseGenerator::IsGenerationInProgress() const
{
	return bGenerationInProgress;
}

FString IntellisenseGenerator::GetCurrentJobId() const
{
	return CurrentJobId;
}

// FGenerationThread implementation
IntellisenseGenerator::FGenerationThread::FGenerationThread(
	FString* InJobId,
	FString* InOutputPath,
	IntellisenseGenerator* InManager,
	const FString& InTarget,
	const FString& InPlatform,
	const FString& InConfiguration,
	bool bInIsUHTCheck)
	: JobId(InJobId)
	, OutputPath(InOutputPath)
	, Manager(InManager)
	, Target(InTarget)
	, Platform(InPlatform)
	, Configuration(InConfiguration)
	, bIsUHTCheck(bInIsUHTCheck)
	, bShouldStop(false)
{
}

IntellisenseGenerator::FGenerationThread::~FGenerationThread()
{
	if (OutputPath)
	{
		delete OutputPath;
	}
}

bool IntellisenseGenerator::FGenerationThread::Init()
{
	return true;
}

uint32 IntellisenseGenerator::FGenerationThread::Run()
{
	FString UBT = Manager->FindUnrealBuildTool();
	if (UBT.IsEmpty())
	{
		// Send error event
		TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
		EventData->SetStringField(TEXT("jobId"), *JobId);
		EventData->SetBoolField(TEXT("success"), false);
		EventData->SetStringField(TEXT("error"), TEXT("UnrealBuildTool not found"));
		Manager->SendGenerationEvent(bIsUHTCheck ? TEXT("intellisense.uhtCheckFinished") : TEXT("intellisense.generationFinished"), EventData, *JobId);
		
		FScopeLock Lock(&Manager->GenerationLock);
		Manager->GenerationThreads.Remove(*JobId);
		Manager->bGenerationInProgress = false;
		Manager->CurrentJobId.Empty();
		return 1;
	}
	
	FString CommandLine;
	if (bIsUHTCheck)
	{
		CommandLine = Manager->BuildUHTCheckCommandLine();
	}
	else
	{
		CommandLine = Manager->BuildGenerateClangDatabaseCommandLine(Target, Platform, Configuration);
	}
	
	UE_LOG(LogTemp, Log, TEXT("Starting IntelliSense generation: %s %s"), *UBT, *CommandLine);
	
	// Send progress event
	TSharedPtr<FJsonObject> ProgressData = MakeShareable(new FJsonObject);
	ProgressData->SetStringField(TEXT("jobId"), *JobId);
	ProgressData->SetNumberField(TEXT("percent"), 10);
	ProgressData->SetStringField(TEXT("phase"), TEXT("Starting UnrealBuildTool"));
	Manager->SendGenerationEvent(TEXT("intellisense.generationProgress"), ProgressData, *JobId);
	
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
	
	if (!ProcessHandle.IsValid())
	{
		UE_LOG(LogTemp, Error, TEXT("Failed to start UnrealBuildTool process"));
		
		TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
		EventData->SetStringField(TEXT("jobId"), *JobId);
		EventData->SetBoolField(TEXT("success"), false);
		EventData->SetStringField(TEXT("error"), TEXT("Failed to start UnrealBuildTool process"));
		Manager->SendGenerationEvent(bIsUHTCheck ? TEXT("intellisense.uhtCheckFinished") : TEXT("intellisense.generationFinished"), EventData, *JobId);
		
		FScopeLock Lock(&Manager->GenerationLock);
		Manager->GenerationThreads.Remove(*JobId);
		Manager->bGenerationInProgress = false;
		Manager->CurrentJobId.Empty();
		
		FPlatformProcess::ClosePipe(ReadPipe, WritePipe);
		return 1;
	}
	
	// Send progress event
	ProgressData = MakeShareable(new FJsonObject);
	ProgressData->SetStringField(TEXT("jobId"), *JobId);
	ProgressData->SetNumberField(TEXT("percent"), 30);
	ProgressData->SetStringField(TEXT("phase"), TEXT("Running UnrealBuildTool"));
	Manager->SendGenerationEvent(TEXT("intellisense.generationProgress"), ProgressData, *JobId);
	
	// Read output
	FString Output;
	int32 LineCount = 0;
	while (FPlatformProcess::IsProcRunning(ProcessHandle) && !bShouldStop)
	{
		FString NewOutput = FPlatformProcess::ReadPipe(ReadPipe);
		if (!NewOutput.IsEmpty())
		{
			Output += NewOutput;
			
			// Count lines for progress indication
			TArray<FString> Lines;
			NewOutput.ParseIntoArrayLines(Lines);
			LineCount += Lines.Num();
			
			// Send output line events (but limit frequency)
			if (LineCount % 10 == 0)
			{
				TSharedPtr<FJsonObject> OutputData = MakeShareable(new FJsonObject);
				OutputData->SetStringField(TEXT("jobId"), *JobId);
				OutputData->SetStringField(TEXT("line"), NewOutput);
				Manager->SendGenerationEvent(TEXT("intellisense.generationOutputLine"), OutputData, *JobId);
			}
		}
		FPlatformProcess::Sleep(0.1f);
	}
	
	if (bShouldStop)
	{
		FPlatformProcess::TerminateProc(ProcessHandle, true);
		
		TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
		EventData->SetStringField(TEXT("jobId"), *JobId);
		EventData->SetBoolField(TEXT("success"), false);
		EventData->SetStringField(TEXT("error"), TEXT("Generation cancelled"));
		Manager->SendGenerationEvent(bIsUHTCheck ? TEXT("intellisense.uhtCheckFinished") : TEXT("intellisense.generationFinished"), EventData, *JobId);
		
		FPlatformProcess::CloseProc(ProcessHandle);
		FPlatformProcess::ClosePipe(ReadPipe, WritePipe);
		
		FScopeLock Lock(&Manager->GenerationLock);
		Manager->GenerationThreads.Remove(*JobId);
		Manager->bGenerationInProgress = false;
		Manager->CurrentJobId.Empty();
		return 1;
	}
	
	// Get exit code
	int32 ReturnCode = 0;
	FPlatformProcess::GetProcReturnCode(ProcessHandle, &ReturnCode);
	
	FPlatformProcess::CloseProc(ProcessHandle);
	FPlatformProcess::ClosePipe(ReadPipe, WritePipe);
	
	// Send progress event
	ProgressData = MakeShareable(new FJsonObject);
	ProgressData->SetStringField(TEXT("jobId"), *JobId);
	ProgressData->SetNumberField(TEXT("percent"), 80);
	ProgressData->SetStringField(TEXT("phase"), TEXT("Locating output files"));
	Manager->SendGenerationEvent(TEXT("intellisense.generationProgress"), ProgressData, *JobId);
	
	if (ReturnCode != 0)
	{
		UE_LOG(LogTemp, Error, TEXT("UnrealBuildTool failed with return code %d"), ReturnCode);
		UE_LOG(LogTemp, Error, TEXT("Output: %s"), *Output);
		
		TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
		EventData->SetStringField(TEXT("jobId"), *JobId);
		EventData->SetBoolField(TEXT("success"), false);
		EventData->SetStringField(TEXT("error"), FString::Printf(TEXT("UnrealBuildTool failed with return code %d"), ReturnCode));
		EventData->SetStringField(TEXT("output"), Output);
		Manager->SendGenerationEvent(bIsUHTCheck ? TEXT("intellisense.uhtCheckFinished") : TEXT("intellisense.generationFinished"), EventData, *JobId);
		
		FScopeLock Lock(&Manager->GenerationLock);
		Manager->GenerationThreads.Remove(*JobId);
		Manager->bGenerationInProgress = false;
		Manager->CurrentJobId.Empty();
		return 1;
	}
	
	// Find the generated compile_commands.json file
	FString ProjectDir = FPaths::GetPath(FPaths::GetProjectFilePath());
	FString CompileCommandsPath;
	
	if (!bIsUHTCheck)
	{
		// Try .vscode first (most common location)
		CompileCommandsPath = FPaths::Combine(ProjectDir, TEXT(".vscode"), TEXT("compile_commands.json"));
		if (!FPaths::FileExists(CompileCommandsPath))
		{
			// Try Saved/ClangDB
			CompileCommandsPath = FPaths::Combine(ProjectDir, TEXT("Saved"), TEXT("ClangDB"), TEXT("compile_commands.json"));
		}
		
		// If still not found, try Intermediate/Build
		if (!FPaths::FileExists(CompileCommandsPath))
		{
			FString IntermediateDir = FPaths::Combine(ProjectDir, TEXT("Intermediate"), TEXT("Build"));
			TArray<FString> FoundFiles;
			IFileManager::Get().FindFilesRecursive(FoundFiles, *IntermediateDir, TEXT("compile_commands.json"), true, false);
			if (FoundFiles.Num() > 0)
			{
				CompileCommandsPath = FoundFiles[0];
			}
		}
		
		// If still not found, try root project directory
		if (!FPaths::FileExists(CompileCommandsPath))
		{
			CompileCommandsPath = FPaths::Combine(ProjectDir, TEXT("compile_commands.json"));
		}
		
		if (FPaths::FileExists(CompileCommandsPath))
		{
			// Normalize path to use forward slashes for cross-platform compatibility
			FString NormalizedPath = CompileCommandsPath;
			NormalizedPath.ReplaceInline(TEXT("\\"), TEXT("/"));
			*OutputPath = NormalizedPath;
			UE_LOG(LogTemp, Log, TEXT("Generated compile_commands.json at: %s"), *NormalizedPath);
		}
		else
		{
			UE_LOG(LogTemp, Warning, TEXT("compile_commands.json not found after generation. Searched locations:"));
			UE_LOG(LogTemp, Warning, TEXT("  - %s/.vscode/compile_commands.json"), *ProjectDir);
			UE_LOG(LogTemp, Warning, TEXT("  - %s/Saved/ClangDB/compile_commands.json"), *ProjectDir);
			UE_LOG(LogTemp, Warning, TEXT("  - %s/Intermediate/Build/*/compile_commands.json"), *ProjectDir);
			UE_LOG(LogTemp, Warning, TEXT("UBT output: %s"), *Output);
		}
	}
	else
	{
		// For UHT check, parse output for diagnostics
		// Store output for diagnostics parsing
		*OutputPath = Output;
	}
	
	// Send finished event
	TSharedPtr<FJsonObject> EventData = MakeShareable(new FJsonObject);
	EventData->SetStringField(TEXT("jobId"), *JobId);
	EventData->SetBoolField(TEXT("success"), bIsUHTCheck || FPaths::FileExists(CompileCommandsPath));
	if (!bIsUHTCheck && FPaths::FileExists(CompileCommandsPath))
	{
		EventData->SetStringField(TEXT("path"), CompileCommandsPath);
	}
	if (bIsUHTCheck)
	{
		EventData->SetStringField(TEXT("output"), Output);
		// Parse UHT diagnostics from output
		TArray<TSharedPtr<FJsonValue>> DiagnosticsArray;
		
		// Simple UHT error parsing (can be enhanced)
		TArray<FString> OutputLines;
		Output.ParseIntoArrayLines(OutputLines);
		for (const FString& Line : OutputLines)
		{
			if (Line.Contains(TEXT("Error:")) || Line.Contains(TEXT("error")))
			{
				TSharedPtr<FJsonObject> Diagnostic = MakeShareable(new FJsonObject);
				Diagnostic->SetStringField(TEXT("severity"), TEXT("error"));
				Diagnostic->SetStringField(TEXT("message"), Line);
				DiagnosticsArray.Add(MakeShareable(new FJsonValueObject(Diagnostic)));
			}
			else if (Line.Contains(TEXT("Warning:")) || Line.Contains(TEXT("warning")))
			{
				TSharedPtr<FJsonObject> Diagnostic = MakeShareable(new FJsonObject);
				Diagnostic->SetStringField(TEXT("severity"), TEXT("warning"));
				Diagnostic->SetStringField(TEXT("message"), Line);
				DiagnosticsArray.Add(MakeShareable(new FJsonValueObject(Diagnostic)));
			}
		}
		EventData->SetArrayField(TEXT("diagnostics"), DiagnosticsArray);
	}
	Manager->SendGenerationEvent(bIsUHTCheck ? TEXT("intellisense.uhtCheckFinished") : TEXT("intellisense.generationFinished"), EventData, *JobId);
	
	FScopeLock Lock(&Manager->GenerationLock);
	Manager->GenerationThreads.Remove(*JobId);
	Manager->bGenerationInProgress = false;
	Manager->CurrentJobId.Empty();
	
	return 0;
}

void IntellisenseGenerator::FGenerationThread::Exit()
{
}

void IntellisenseGenerator::FGenerationThread::Cancel()
{
	bShouldStop = true;
}

