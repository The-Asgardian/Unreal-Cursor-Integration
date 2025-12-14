// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"

struct FIPCBaseMessage
{
	FString Id;
	FString Type; // "request", "response", "event"
	
	bool FromJson(const TSharedPtr<FJsonObject>& JsonObject);
	TSharedPtr<FJsonObject> ToJson() const;
};

struct FIPCRequestMessage : public FIPCBaseMessage
{
	FString Method;
	TSharedPtr<FJsonObject> Params;
	FString CancelToken;
	
	bool FromJson(const TSharedPtr<FJsonObject>& JsonObject);
	TSharedPtr<FJsonObject> ToJson() const;
};

struct FIPCResponseMessage : public FIPCBaseMessage
{
	TSharedPtr<FJsonObject> Result;
	
	struct FError
	{
		FString Code;
		FString Message;
		TSharedPtr<FJsonObject> Data;
	};
	
	TOptional<FError> Error;
	
	bool FromJson(const TSharedPtr<FJsonObject>& JsonObject);
	TSharedPtr<FJsonObject> ToJson() const;
};

struct FIPCEventMessage : public FIPCBaseMessage
{
	FString Event;
	TSharedPtr<FJsonObject> Data;
	
	bool FromJson(const TSharedPtr<FJsonObject>& JsonObject);
	TSharedPtr<FJsonObject> ToJson() const;
};

