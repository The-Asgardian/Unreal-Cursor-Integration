// Copyright Epic Games, Inc. All Rights Reserved.

#include "IPC/MessageHandler.h"
#include "IPC/IPCServer.h"
#include "Build/BuildManager.h"
#include "LiveCoding/LiveCodingManager.h"
#include "Run/RunManager.h"
#include "Logs/LogCaptureDevice.h"
#include "UHT/UHTMetadataExtractor.h"
#include "UHT/UHTMetadataCache.h"
#include "Reflection/ReflectionQueryManager.h"
#include "Reflection/BlueprintUsageTracker.h"
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
	
	// UHT metadata commands
	Server.RegisterHandler(TEXT("uht.runAndCollect"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		FString ModuleName;
		Request.Params->TryGetStringField(TEXT("module"), ModuleName);
		
		if (ModuleName.IsEmpty())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Module name required"), nullptr);
			return;
		}
		
		// Force refresh and collect metadata
		TArray<FUHTClassMetadata> Metadata = UHTMetadataCache::Get().GetModuleMetadata(ModuleName, true);
		
		// Build response
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetStringField(TEXT("module"), ModuleName);
		
		TArray<TSharedPtr<FJsonValue>> ClassesArray;
		for (const FUHTClassMetadata& ClassMetadata : Metadata)
		{
			TSharedPtr<FJsonObject> ClassObject = MakeShareable(new FJsonObject);
			ClassObject->SetStringField(TEXT("name"), ClassMetadata.Name);
			ClassObject->SetStringField(TEXT("super"), ClassMetadata.Super);
			ClassObject->SetStringField(TEXT("module"), ClassMetadata.Module);
			
			// Metadata
			TSharedPtr<FJsonObject> MetadataObject = MakeShareable(new FJsonObject);
			for (const auto& Pair : ClassMetadata.Metadata)
			{
				MetadataObject->SetStringField(Pair.Key, Pair.Value);
			}
			ClassObject->SetObjectField(TEXT("metadata"), MetadataObject);
			
			// Properties - convert FJsonObject to FJsonValue
			TArray<TSharedPtr<FJsonValue>> PropertiesArray;
			for (const TSharedPtr<FJsonObject>& Prop : ClassMetadata.Properties)
			{
				PropertiesArray.Add(MakeShareable(new FJsonValueObject(Prop)));
			}
			ClassObject->SetArrayField(TEXT("properties"), PropertiesArray);
			
			// Functions - convert FJsonObject to FJsonValue
			TArray<TSharedPtr<FJsonValue>> FunctionsArray;
			for (const TSharedPtr<FJsonObject>& Func : ClassMetadata.Functions)
			{
				FunctionsArray.Add(MakeShareable(new FJsonValueObject(Func)));
			}
			ClassObject->SetArrayField(TEXT("functions"), FunctionsArray);
			
			ClassesArray.Add(MakeShareable(new FJsonValueObject(ClassObject)));
		}
		Result->SetArrayField(TEXT("classes"), ClassesArray);
		
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("uht.getReflectionSummary"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		// Get summary of all modules
		FString ProjectDir = FPaths::GetPath(FPaths::GetProjectFilePath());
		FString IntermediateDir = FPaths::Combine(ProjectDir, TEXT("Intermediate"), TEXT("Build"));
		
		TArray<FString> FoundFiles;
		IFileManager::Get().FindFilesRecursive(FoundFiles, *IntermediateDir, TEXT("*.generated.h"), true, false);
		
		TSet<FString> Modules;
		for (const FString& FilePath : FoundFiles)
		{
			// Extract module name from path
			FString Filename = FPaths::GetBaseFilename(FilePath);
			// Module name is typically before the first underscore or in the path
			int32 UnderscorePos = Filename.Find(TEXT("_"));
			if (UnderscorePos != INDEX_NONE)
			{
				FString ModuleName = Filename.Left(UnderscorePos);
				if (!ModuleName.IsEmpty())
				{
					Modules.Add(ModuleName);
				}
			}
		}
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		TArray<TSharedPtr<FJsonValue>> ModulesArray;
		for (const FString& Module : Modules)
		{
			ModulesArray.Add(MakeShareable(new FJsonValueString(Module)));
		}
		Result->SetArrayField(TEXT("modules"), ModulesArray);
		
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("uht.getClassMetadata"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		FString ModuleName, ClassName;
		Request.Params->TryGetStringField(TEXT("module"), ModuleName);
		Request.Params->TryGetStringField(TEXT("className"), ClassName);
		
		if (ModuleName.IsEmpty() || ClassName.IsEmpty())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Module name and class name required"), nullptr);
			return;
		}
		
		FUHTClassMetadata ClassMetadata;
		if (!UHTMetadataCache::Get().GetClassMetadata(ModuleName, ClassName, ClassMetadata))
		{
			IPCServer::Get().SendError(Request.Id, TEXT("NOT_FOUND"), TEXT("Class not found"), nullptr);
			return;
		}
		
		// Build response
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetStringField(TEXT("name"), ClassMetadata.Name);
		Result->SetStringField(TEXT("super"), ClassMetadata.Super);
		Result->SetStringField(TEXT("module"), ClassMetadata.Module);
		
		// Metadata
		TSharedPtr<FJsonObject> MetadataObject = MakeShareable(new FJsonObject);
		for (const auto& Pair : ClassMetadata.Metadata)
		{
			MetadataObject->SetStringField(Pair.Key, Pair.Value);
		}
		Result->SetObjectField(TEXT("metadata"), MetadataObject);
		
		// Properties - convert FJsonObject to FJsonValue
		TArray<TSharedPtr<FJsonValue>> PropertiesArray;
		for (const TSharedPtr<FJsonObject>& Prop : ClassMetadata.Properties)
		{
			PropertiesArray.Add(MakeShareable(new FJsonValueObject(Prop)));
		}
		Result->SetArrayField(TEXT("properties"), PropertiesArray);
		
		// Functions - convert FJsonObject to FJsonValue
		TArray<TSharedPtr<FJsonValue>> FunctionsArray;
		for (const TSharedPtr<FJsonObject>& Func : ClassMetadata.Functions)
		{
			FunctionsArray.Add(MakeShareable(new FJsonValueObject(Func)));
		}
		Result->SetArrayField(TEXT("functions"), FunctionsArray);
		
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("uht.getFunctionMetadata"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		FString ModuleName, ClassName, FunctionName;
		Request.Params->TryGetStringField(TEXT("module"), ModuleName);
		Request.Params->TryGetStringField(TEXT("className"), ClassName);
		Request.Params->TryGetStringField(TEXT("functionName"), FunctionName);
		
		if (ModuleName.IsEmpty() || ClassName.IsEmpty() || FunctionName.IsEmpty())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Module name, class name, and function name required"), nullptr);
			return;
		}
		
		FUHTClassMetadata ClassMetadata;
		if (!UHTMetadataCache::Get().GetClassMetadata(ModuleName, ClassName, ClassMetadata))
		{
			IPCServer::Get().SendError(Request.Id, TEXT("NOT_FOUND"), TEXT("Class not found"), nullptr);
			return;
		}
		
		// Find function
		TSharedPtr<FJsonObject> FunctionMetadata;
		for (const TSharedPtr<FJsonObject>& Func : ClassMetadata.Functions)
		{
			FString FuncName;
			if (Func->TryGetStringField(TEXT("name"), FuncName) && FuncName == FunctionName)
			{
				FunctionMetadata = Func;
				break;
			}
		}
		
		if (!FunctionMetadata.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("NOT_FOUND"), TEXT("Function not found"), nullptr);
			return;
		}
		
		TSharedPtr<FJsonObject> Result = FunctionMetadata;
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("uht.getPropertyMetadata"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		FString ModuleName, ClassName, PropertyName;
		Request.Params->TryGetStringField(TEXT("module"), ModuleName);
		Request.Params->TryGetStringField(TEXT("className"), ClassName);
		Request.Params->TryGetStringField(TEXT("propertyName"), PropertyName);
		
		if (ModuleName.IsEmpty() || ClassName.IsEmpty() || PropertyName.IsEmpty())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Module name, class name, and property name required"), nullptr);
			return;
		}
		
		FUHTClassMetadata ClassMetadata;
		if (!UHTMetadataCache::Get().GetClassMetadata(ModuleName, ClassName, ClassMetadata))
		{
			IPCServer::Get().SendError(Request.Id, TEXT("NOT_FOUND"), TEXT("Class not found"), nullptr);
			return;
		}
		
		// Find property
		TSharedPtr<FJsonObject> PropertyMetadata;
		for (const TSharedPtr<FJsonObject>& Prop : ClassMetadata.Properties)
		{
			FString PropName;
			if (Prop->TryGetStringField(TEXT("name"), PropName) && PropName == PropertyName)
			{
				PropertyMetadata = Prop;
				break;
			}
		}
		
		if (!PropertyMetadata.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("NOT_FOUND"), TEXT("Property not found"), nullptr);
			return;
		}
		
		TSharedPtr<FJsonObject> Result = PropertyMetadata;
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	// Reflection commands
	Server.RegisterHandler(TEXT("reflection.listClasses"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		TArray<FString> ClassNames = ReflectionQueryManager::Get().ListClasses();
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		TArray<TSharedPtr<FJsonValue>> ClassesArray;
		for (const FString& ClassName : ClassNames)
		{
			ClassesArray.Add(MakeShareable(new FJsonValueString(ClassName)));
		}
		Result->SetArrayField(TEXT("classes"), ClassesArray);
		
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("reflection.getClass"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		FString ClassName;
		Request.Params->TryGetStringField(TEXT("className"), ClassName);
		
		if (ClassName.IsEmpty())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Class name required"), nullptr);
			return;
		}
		
		TSharedPtr<FJsonObject> ClassJson = ReflectionQueryManager::Get().GetClass(ClassName);
		if (!ClassJson.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("NOT_FOUND"), TEXT("Class not found"), nullptr);
			return;
		}
		
		IPCServer::Get().SendResponse(Request.Id, ClassJson, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("reflection.getFunctions"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		FString ClassName;
		Request.Params->TryGetStringField(TEXT("className"), ClassName);
		
		if (ClassName.IsEmpty())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Class name required"), nullptr);
			return;
		}
		
		TArray<TSharedPtr<FJsonObject>> Functions = ReflectionQueryManager::Get().GetFunctions(ClassName);
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		TArray<TSharedPtr<FJsonValue>> FunctionsArray;
		for (const TSharedPtr<FJsonObject>& Func : Functions)
		{
			FunctionsArray.Add(MakeShareable(new FJsonValueObject(Func)));
		}
		Result->SetArrayField(TEXT("functions"), FunctionsArray);
		
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("reflection.getProperties"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		FString ClassName;
		Request.Params->TryGetStringField(TEXT("className"), ClassName);
		
		if (ClassName.IsEmpty())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Class name required"), nullptr);
			return;
		}
		
		TArray<TSharedPtr<FJsonObject>> Properties = ReflectionQueryManager::Get().GetProperties(ClassName);
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		TArray<TSharedPtr<FJsonValue>> PropertiesArray;
		for (const TSharedPtr<FJsonObject>& Prop : Properties)
		{
			PropertiesArray.Add(MakeShareable(new FJsonValueObject(Prop)));
		}
		Result->SetArrayField(TEXT("properties"), PropertiesArray);
		
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("reflection.findSymbol"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		FString SymbolName;
		Request.Params->TryGetStringField(TEXT("symbolName"), SymbolName);
		
		if (SymbolName.IsEmpty())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Symbol name required"), nullptr);
			return;
		}
		
		TSharedPtr<FJsonObject> SymbolJson = ReflectionQueryManager::Get().FindSymbol(SymbolName);
		if (!SymbolJson.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("NOT_FOUND"), TEXT("Symbol not found"), nullptr);
			return;
		}
		
		IPCServer::Get().SendResponse(Request.Id, SymbolJson, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("reflection.getCDODefaults"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		FString ClassName;
		Request.Params->TryGetStringField(TEXT("className"), ClassName);
		
		if (ClassName.IsEmpty())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Class name required"), nullptr);
			return;
		}
		
		TSharedPtr<FJsonObject> CDOJson = ReflectionQueryManager::Get().GetCDODefaults(ClassName);
		if (!CDOJson.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("NOT_FOUND"), TEXT("Class not found or no CDO"), nullptr);
			return;
		}
		
		IPCServer::Get().SendResponse(Request.Id, CDOJson, nullptr);
	}));
	
	Server.RegisterHandler(TEXT("reflection.getUsageData"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		if (!Request.Params.IsValid())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Missing params"), nullptr);
			return;
		}
		
		FString SymbolName, ClassName;
		Request.Params->TryGetStringField(TEXT("symbolName"), SymbolName);
		Request.Params->TryGetStringField(TEXT("className"), ClassName);
		
		if (SymbolName.IsEmpty() || ClassName.IsEmpty())
		{
			IPCServer::Get().SendError(Request.Id, TEXT("INVALID_PARAMS"), TEXT("Symbol name and class name required"), nullptr);
			return;
		}
		
		FBlueprintUsageInfo UsageInfo = BlueprintUsageTracker::Get().GetUsageData(SymbolName, ClassName);
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetStringField(TEXT("symbolName"), SymbolName);
		Result->SetStringField(TEXT("className"), ClassName);
		Result->SetNumberField(TEXT("usageCount"), UsageInfo.UsageCount);
		
		TArray<TSharedPtr<FJsonValue>> UsedInArray;
		for (const FString& BlueprintPath : UsageInfo.UsedInBlueprints)
		{
			UsedInArray.Add(MakeShareable(new FJsonValueString(BlueprintPath)));
		}
		Result->SetArrayField(TEXT("usedInBlueprints"), UsedInArray);
		
		TArray<TSharedPtr<FJsonValue>> OverriddenInArray;
		for (const FString& BlueprintPath : UsageInfo.OverriddenInBlueprints)
		{
			OverriddenInArray.Add(MakeShareable(new FJsonValueString(BlueprintPath)));
		}
		Result->SetArrayField(TEXT("overriddenInBlueprints"), OverriddenInArray);
		
		IPCServer::Get().SendResponse(Request.Id, Result, nullptr);
	}));
}

