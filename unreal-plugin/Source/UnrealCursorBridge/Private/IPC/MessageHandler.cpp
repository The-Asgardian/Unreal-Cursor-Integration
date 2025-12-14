// Copyright Epic Games, Inc. All Rights Reserved.

#include "IPC/MessageHandler.h"
#include "IPC/IPCServer.h"
#include "Dom/JsonObject.h"
#include "Misc/App.h"
#include "Misc/EngineVersion.h"
#include "HAL/PlatformFilemanager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

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
		
		IPCServer::Get().SendResponse(Request.Id, Result);
	}));
	
	// Ping
	Server.RegisterHandler(TEXT("ping"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetStringField(TEXT("pong"), TEXT("pong"));
		IPCServer::Get().SendResponse(Request.Id, Result);
	}));
	
	// Status
	Server.RegisterHandler(TEXT("status.get"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetBoolField(TEXT("connected"), true);
		Result->SetStringField(TEXT("status"), TEXT("ready"));
		IPCServer::Get().SendResponse(Request.Id, Result);
	}));
	
	// Project info
	Server.RegisterHandler(TEXT("project.info"), FIPCRequestHandler::CreateLambda([](const FIPCRequestMessage& Request)
	{
		FString ProjectPath = FPaths::GetProjectFilePath();
		FString ProjectName = FPaths::GetBaseFilename(ProjectPath);
		
		TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
		Result->SetStringField(TEXT("projectName"), ProjectName);
		Result->SetStringField(TEXT("projectPath"), ProjectPath);
		IPCServer::Get().SendResponse(Request.Id, Result);
	}));
}

