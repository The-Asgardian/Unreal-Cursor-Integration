// Copyright Epic Games, Inc. All Rights Reserved.

#include "IPC/IPCProtocol.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"

bool FIPCBaseMessage::FromJson(const TSharedPtr<FJsonObject>& JsonObject)
{
	if (!JsonObject.IsValid())
	{
		return false;
	}
	
	JsonObject->TryGetStringField(TEXT("id"), Id);
	JsonObject->TryGetStringField(TEXT("type"), Type);
	
	return !Id.IsEmpty() && !Type.IsEmpty();
}

TSharedPtr<FJsonObject> FIPCBaseMessage::ToJson() const
{
	TSharedPtr<FJsonObject> JsonObject = MakeShareable(new FJsonObject);
	JsonObject->SetStringField(TEXT("id"), Id);
	JsonObject->SetStringField(TEXT("type"), Type);
	return JsonObject;
}

bool FIPCRequestMessage::FromJson(const TSharedPtr<FJsonObject>& JsonObject)
{
	if (!FIPCBaseMessage::FromJson(JsonObject))
	{
		return false;
	}
	
	JsonObject->TryGetStringField(TEXT("method"), Method);
	JsonObject->TryGetStringField(TEXT("cancelToken"), CancelToken);
	
	const TSharedPtr<FJsonObject>* ParamsObject = nullptr;
	if (JsonObject->TryGetObjectField(TEXT("params"), ParamsObject))
	{
		Params = *ParamsObject;
	}
	
	return !Method.IsEmpty();
}

TSharedPtr<FJsonObject> FIPCRequestMessage::ToJson() const
{
	TSharedPtr<FJsonObject> JsonObject = FIPCBaseMessage::ToJson();
	JsonObject->SetStringField(TEXT("method"), Method);
	if (Params.IsValid())
	{
		JsonObject->SetObjectField(TEXT("params"), Params);
	}
	if (!CancelToken.IsEmpty())
	{
		JsonObject->SetStringField(TEXT("cancelToken"), CancelToken);
	}
	return JsonObject;
}

bool FIPCResponseMessage::FromJson(const TSharedPtr<FJsonObject>& JsonObject)
{
	if (!FIPCBaseMessage::FromJson(JsonObject))
	{
		return false;
	}
	
	const TSharedPtr<FJsonObject>* ResultObject = nullptr;
	if (JsonObject->TryGetObjectField(TEXT("result"), ResultObject))
	{
		Result = *ResultObject;
	}
	
	const TSharedPtr<FJsonObject>* ErrorObject = nullptr;
	if (JsonObject->TryGetObjectField(TEXT("error"), ErrorObject))
	{
		FError ErrorValue;
		(*ErrorObject)->TryGetStringField(TEXT("code"), ErrorValue.Code);
		(*ErrorObject)->TryGetStringField(TEXT("message"), ErrorValue.Message);
		const TSharedPtr<FJsonObject>* ErrorDataObject = nullptr;
		if ((*ErrorObject)->TryGetObjectField(TEXT("data"), ErrorDataObject))
		{
			ErrorValue.Data = *ErrorDataObject;
		}
		Error = ErrorValue;
	}
	
	return true;
}

TSharedPtr<FJsonObject> FIPCResponseMessage::ToJson() const
{
	TSharedPtr<FJsonObject> JsonObject = FIPCBaseMessage::ToJson();
	if (Result.IsValid())
	{
		JsonObject->SetObjectField(TEXT("result"), Result);
	}
	if (Error.IsSet())
	{
		TSharedPtr<FJsonObject> ErrorObject = MakeShareable(new FJsonObject);
		ErrorObject->SetStringField(TEXT("code"), Error.GetValue().Code);
		ErrorObject->SetStringField(TEXT("message"), Error.GetValue().Message);
		if (Error.GetValue().Data.IsValid())
		{
			ErrorObject->SetObjectField(TEXT("data"), Error.GetValue().Data);
		}
		JsonObject->SetObjectField(TEXT("error"), ErrorObject);
	}
	return JsonObject;
}

bool FIPCEventMessage::FromJson(const TSharedPtr<FJsonObject>& JsonObject)
{
	if (!FIPCBaseMessage::FromJson(JsonObject))
	{
		return false;
	}
	
	JsonObject->TryGetStringField(TEXT("event"), Event);
	
	const TSharedPtr<FJsonObject>* DataObject = nullptr;
	if (JsonObject->TryGetObjectField(TEXT("data"), DataObject))
	{
		Data = *DataObject;
	}
	
	return !Event.IsEmpty();
}

TSharedPtr<FJsonObject> FIPCEventMessage::ToJson() const
{
	TSharedPtr<FJsonObject> JsonObject = FIPCBaseMessage::ToJson();
	JsonObject->SetStringField(TEXT("event"), Event);
	if (Data.IsValid())
	{
		JsonObject->SetObjectField(TEXT("data"), Data);
	}
	return JsonObject;
}

