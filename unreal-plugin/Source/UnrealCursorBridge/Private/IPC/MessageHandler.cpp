// Copyright Epic Games, Inc. All Rights Reserved.

#include "IPC/MessageHandler.h"
#include "IPC/IPCServer.h"
#include "Build/BuildManager.h"
#include "LiveCoding/LiveCodingManager.h"
#include "Run/RunManager.h"
#include "Logs/LogCaptureDevice.h"
#include "Dom/JsonObject.h"
#include "Misc/App.h"
#include "Misc/EngineVersion.h"
#include "HAL/PlatformFilemanager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Dom/JsonValue.h"
#include "HAL/PlatformProcess.h"

void MessageHandler::RegisterHandlers()
{
	IPCServer& Server = IPCServer::Get();
	
	// Client hello handshake
	Server.RegisterHandler(TEXT("client.hello"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		// Get project info
		FString ProjectPath = FPaths::GetProjectFilePath();
		FString ProjectName = FPaths::GetBaseFilename(ProjectPath);
		FString EngineVersion = FEngineVersion::Current().ToString();
		
		// Detect capabilities
		bool bLiveCodingAvailable = false;
		bool bInsightsAvailable = false;
		bool bAssetEditingAvailable = true; // AssetTools is always available in editor
		bool bBlueprintEditingAvailable = true; // Blueprint editing is always available in editor
		
		// Check Live Coding availability (simplified - would check module availability)
		#if WITH_LIVE_CODING
		bLiveCodingAvailable = true;
		#endif
		
		// Check Insights availability (simplified)
		bInsightsAvailable = true; // Assume available in UE 5.6+
		
		// Build response
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetStringField(TEXT("engineVersion"), EngineVersion);
		Result->SetStringField(TEXT("projectName"), ProjectName);
		Result->SetStringField(TEXT("projectPath"), ProjectPath);
		
		TArray<TSharedPtr<FJsonValue>> PlatformsArray;
		PlatformsArray.Add(MakeShareable(new FJsonValueString(TEXT("Win64"))));
		#if PLATFORM_MAC
		PlatformsArray.Add(MakeShareable(new FJsonValueString(TEXT("Mac"))));
		#endif
		#if PLATFORM_LINUX
		PlatformsArray.Add(MakeShareable(new FJsonValueString(TEXT("Linux"))));
		#endif
		Result->SetArrayField(TEXT("supportedPlatforms"), PlatformsArray);
		
		TSharedPtr<FJsonObject> Capabilities = MakeShareable(new FJsonObject);
		Capabilities->SetBoolField(TEXT("liveCoding"), bLiveCodingAvailable);
		Capabilities->SetBoolField(TEXT("insights"), bInsightsAvailable);
		Capabilities->SetBoolField(TEXT("assetEditing"), bAssetEditingAvailable);
		Capabilities->SetBoolField(TEXT("blueprintEditing"), bBlueprintEditingAvailable);
		Result->SetObjectField(TEXT("capabilities"), Capabilities);
		
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	// Ping
	Server.RegisterHandler(TEXT("ping"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetStringField(TEXT("pong"), TEXT("pong"));
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	// Status
	Server.RegisterHandler(TEXT("status.get"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("connected"), true);
		Result->SetStringField(TEXT("status"), TEXT("ready"));
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	// Project info
	Server.RegisterHandler(TEXT("project.info"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		FString ProjectPath = FPaths::GetProjectFilePath();
		FString ProjectName = FPaths::GetBaseFilename(ProjectPath);
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetStringField(TEXT("projectName"), ProjectName);
		Result->SetStringField(TEXT("projectPath"), ProjectPath);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	// Build commands
	Server.RegisterHandler(TEXT("build.start"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		FString Target, Configuration, Platform, ProjectPath;
		TArray<FString> ExtraArgs;
		
		Request.Params->TryGetStringField(TEXT("target"), Target);
		Request.Params->TryGetStringField(TEXT("configuration"), Configuration);
		Request.Params->TryGetStringField(TEXT("platform"), Platform);
		Request.Params->TryGetStringField(TEXT("projectPath"), ProjectPath);
		
		const TArray<TSharedPtr<FJsonValue>>* ExtraArgsArray = nullptr;
		if (Request.Params->TryGetArrayField(TEXT("extraArgs"), ExtraArgsArray))
		{
			for (const TSharedPtr<FJsonValue>& ArgValue : *ExtraArgsArray)
			{
				FString Arg;
				if (ArgValue->TryGetString(Arg))
				{
					ExtraArgs.Add(Arg);
				}
			}
		}
		
		// Use project path from engine if not provided
		if (ProjectPath.IsEmpty())
		{
			ProjectPath = FPaths::GetProjectFilePath();
		}
		
		FString BuildId = BuildManager::Get().StartBuild(Target, Configuration, Platform, ProjectPath, ExtraArgs);
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetStringField(TEXT("buildId"), BuildId);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("build.cancel"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		FString BuildId;
		Request.Params->TryGetStringField(TEXT("buildId"), BuildId);
		
		BuildManager::Get().CancelBuild(BuildId);
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("cancelled"), true);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("build.listTargets"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		
		TArray<TSharedPtr<FJsonValue>> TargetsArray;
		for (const FString& Target : BuildManager::Get().GetAvailableTargets())
		{
			TargetsArray.Add(MakeShareable(new FJsonValueString(Target)));
		}
		Result->SetArrayField(TEXT("targets"), TargetsArray);
		
		TArray<TSharedPtr<FJsonValue>> ConfigsArray;
		for (const FString& Config : BuildManager::Get().GetAvailableConfigurations())
		{
			ConfigsArray.Add(MakeShareable(new FJsonValueString(Config)));
		}
		Result->SetArrayField(TEXT("configurations"), ConfigsArray);
		
		TArray<TSharedPtr<FJsonValue>> PlatformsArray;
		for (const FString& Platform : BuildManager::Get().GetAvailablePlatforms())
		{
			PlatformsArray.Add(MakeShareable(new FJsonValueString(Platform)));
		}
		Result->SetArrayField(TEXT("platforms"), PlatformsArray);
		
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	// Live Coding commands
	Server.RegisterHandler(TEXT("livecoding.status"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		LiveCodingManager& LC = LiveCodingManager::Get();
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("enabled"), LC.IsEnabled());
		Result->SetBoolField(TEXT("compiling"), LC.IsCompiling());
		Result->SetStringField(TEXT("lastResult"), LC.GetLastResult());
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("livecoding.enable"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		bool bEnabled = false;
		Request.Params->TryGetBoolField(TEXT("enabled"), bEnabled);
		
		LiveCodingManager::Get().SetEnabled(bEnabled);
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("enabled"), bEnabled);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("livecoding.compile"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		bool bStarted = LiveCodingManager::Get().Compile();
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("started"), bStarted);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("livecoding.restart"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		bool bRestarted = LiveCodingManager::Get().Restart();
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("restarted"), bRestarted);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	// Run commands
	Server.RegisterHandler(TEXT("run.playPIE"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		bool bStarted = RunManager::Get().PlayInEditor();
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("started"), bStarted);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("run.stopPIE"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		RunManager::Get().StopPIE();
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("stopped"), true);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("run.standalone"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		bool bStarted = RunManager::Get().StartStandalone();
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("started"), bStarted);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("run.dedicatedServer"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		bool bStarted = RunManager::Get().StartDedicatedServer();
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("started"), bStarted);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	// Project file generation
	Server.RegisterHandler(TEXT("project.generateFiles"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		FString ProjectPath = FPaths::GetProjectFilePath();
		
		// Use UnrealVersionSelector to generate project files
		// This is the standard way to generate project files in UE 5.6
		FString EngineDir = FPaths::EngineDir();
		FString UProjectFile = ProjectPath;
		
		#if PLATFORM_WINDOWS
		FString UnrealVersionSelector = FPaths::Combine(EngineDir, TEXT("Binaries"), TEXT("DotNET"), TEXT("UnrealVersionSelector"), TEXT("UnrealVersionSelector.exe"));
		FString CommandLine = FString::Printf(TEXT("/projectfiles \"%s\""), *UProjectFile);
		
		uint32 ProcessId = 0;
		FProcHandle ProcessHandle = FPlatformProcess::CreateProc(
			*UnrealVersionSelector,
			*CommandLine,
			false,
			true,
			true,
			&ProcessId,
			0,
			nullptr,
			nullptr,
			nullptr
		);
		
		bool bSuccess = ProcessHandle.IsValid();
		if (bSuccess)
		{
			FPlatformProcess::CloseProc(ProcessHandle);
		}
		#elif PLATFORM_MAC || PLATFORM_LINUX
		// On Mac/Linux, use the shell script
		FString GenerateScript = FPaths::Combine(EngineDir, TEXT("Build"), TEXT("BatchFiles"), TEXT("Mac"), TEXT("GenerateProjectFiles.sh"));
		if (!FPaths::FileExists(GenerateScript))
		{
			GenerateScript = FPaths::Combine(EngineDir, TEXT("Build"), TEXT("BatchFiles"), TEXT("Linux"), TEXT("GenerateProjectFiles.sh"));
		}
		
		FString CommandLine = FString::Printf(TEXT("\"%s\" \"%s\""), *GenerateScript, *UProjectFile);
		
		uint32 ProcessId = 0;
		FProcHandle ProcessHandle = FPlatformProcess::CreateProc(
			TEXT("/bin/sh"),
			*CommandLine,
			false,
			true,
			true,
			&ProcessId,
			0,
			nullptr,
			nullptr,
			nullptr
		);
		
		bool bSuccess = ProcessHandle.IsValid();
		if (bSuccess)
		{
			FPlatformProcess::CloseProc(ProcessHandle);
		}
		#else
		bool bSuccess = false;
		#endif
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("success"), bSuccess);
		if (!bSuccess)
		{
			Result->SetStringField(TEXT("error"), TEXT("Failed to generate project files"));
		}
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	// Log subscription commands
	Server.RegisterHandler(TEXT("logs.subscribe"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		TArray<FString> Categories;
		FString Verbosity;
		FString Search;
		
		const TArray<TSharedPtr<FJsonValue>>* CategoriesArray = nullptr;
		if (Request.Params->TryGetArrayField(TEXT("categories"), CategoriesArray))
		{
			for (const TSharedPtr<FJsonValue>& CatValue : *CategoriesArray)
			{
				FString Cat;
				if (CatValue->TryGetString(Cat))
				{
					Categories.Add(Cat);
				}
			}
		}
		
		Request.Params->TryGetStringField(TEXT("verbosity"), Verbosity);
		Request.Params->TryGetStringField(TEXT("search"), Search);
		
		FLogCaptureDevice::Get().Subscribe(Categories, Verbosity, Search);
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("subscribed"), true);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("logs.unsubscribe"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		FLogCaptureDevice::Get().Unsubscribe();
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("unsubscribed"), true);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("logs.clear"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		// Clear is handled on the client side, but we acknowledge it
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("cleared"), true);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("logs.setFilter"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		FString Filter;
		Request.Params->TryGetStringField(TEXT("filter"), Filter);
		
		// Update search filter
		FLogCaptureDevice::Get().Subscribe(TArray<FString>(), TEXT(""), Filter);
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("filterSet"), true);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("logs.export"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		// Export is handled on the client side with stored logs
		// This is just for API completeness
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		TArray<TSharedPtr<FJsonValue>> LogsArray;
		Result->SetArrayField(TEXT("logs"), LogsArray);
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
}

