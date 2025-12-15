// Copyright Epic Games, Inc. All Rights Reserved.

#include "Reflection/ReflectionQueryManager.h"
#include "UObject/UObjectIterator.h"
#include "UObject/Class.h"
#include "UObject/UnrealType.h"
#include "UObject/PropertyPortFlags.h"
#include "UObject/TextProperty.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Serialization/JsonSerializer.h"
#include "Engine/Engine.h"
#include "HAL/PlatformProcess.h"

ReflectionQueryManager& ReflectionQueryManager::Get()
{
	static ReflectionQueryManager Instance;
	return Instance;
}

TArray<FString> ReflectionQueryManager::ListClasses()
{
	TArray<FString> ClassNames;
	
	for (TObjectIterator<UClass> ClassIterator; ClassIterator; ++ClassIterator)
	{
		UClass* Class = *ClassIterator;
		if (Class && !Class->HasAnyClassFlags(CLASS_Deprecated | CLASS_NewerVersionExists))
		{
			ClassNames.Add(Class->GetName());
		}
	}
	
	return ClassNames;
}

TSharedPtr<FJsonObject> ReflectionQueryManager::GetClass(const FString& ClassName)
{
	FScopeLock Lock(&CacheLock);
	
	// Check cache first
	if (ClassCache.Contains(ClassName))
	{
		return ClassCache[ClassName];
	}
	
	// Find the class
	UClass* Class = FindObject<UClass>(nullptr, *ClassName);
	if (!Class)
	{
		// Try with full path
		Class = LoadClass<UObject>(nullptr, *ClassName);
	}
	
	if (!Class)
	{
		return nullptr;
	}
	
	TSharedPtr<FJsonObject> ClassJson = ClassToJson(Class);
	
	// Cache it
	ClassCache.Add(ClassName, ClassJson);
	
	return ClassJson;
}

TArray<TSharedPtr<FJsonObject>> ReflectionQueryManager::GetFunctions(const FString& ClassName)
{
	TArray<TSharedPtr<FJsonObject>> Functions;
	
	UClass* Class = FindObject<UClass>(nullptr, *ClassName);
	if (!Class)
	{
		Class = LoadClass<UObject>(nullptr, *ClassName);
	}
	
	if (!Class)
	{
		return Functions;
	}
	
	// Iterate through all functions
	for (TFieldIterator<UFunction> FuncIterator(Class, EFieldIteratorFlags::ExcludeSuper); FuncIterator; ++FuncIterator)
	{
		UFunction* Function = *FuncIterator;
		if (Function)
		{
			Functions.Add(FunctionToJson(Function));
		}
	}
	
	return Functions;
}

TArray<TSharedPtr<FJsonObject>> ReflectionQueryManager::GetProperties(const FString& ClassName)
{
	TArray<TSharedPtr<FJsonObject>> Properties;
	
	UClass* Class = FindObject<UClass>(nullptr, *ClassName);
	if (!Class)
	{
		Class = LoadClass<UObject>(nullptr, *ClassName);
	}
	
	if (!Class)
	{
		return Properties;
	}
	
	// Iterate through all properties
	for (TFieldIterator<FProperty> PropIterator(Class, EFieldIteratorFlags::ExcludeSuper); PropIterator; ++PropIterator)
	{
		FProperty* Property = *PropIterator;
		if (Property)
		{
			Properties.Add(PropertyToJson(Property));
		}
	}
	
	return Properties;
}

TSharedPtr<FJsonObject> ReflectionQueryManager::FindSymbol(const FString& SymbolName)
{
	// First try as a class
	TSharedPtr<FJsonObject> Result = GetClass(SymbolName);
	if (Result.IsValid())
	{
		return Result;
	}
	
	// Then try to find as function or property in any class
	for (TObjectIterator<UClass> ClassIterator; ClassIterator; ++ClassIterator)
	{
		UClass* Class = *ClassIterator;
		if (!Class)
		{
			continue;
		}
		
		// Check functions
		for (TFieldIterator<UFunction> FuncIterator(Class); FuncIterator; ++FuncIterator)
		{
			UFunction* Function = *FuncIterator;
			if (Function && Function->GetName() == SymbolName)
			{
				TSharedPtr<FJsonObject> FuncJson = FunctionToJson(Function);
				FuncJson->SetStringField(TEXT("symbolType"), TEXT("function"));
				FuncJson->SetStringField(TEXT("className"), Class->GetName());
				return FuncJson;
			}
		}
		
		// Check properties
		for (TFieldIterator<FProperty> PropIterator(Class); PropIterator; ++PropIterator)
		{
			FProperty* Property = *PropIterator;
			if (Property && Property->GetName() == SymbolName)
			{
				TSharedPtr<FJsonObject> PropJson = PropertyToJson(Property);
				PropJson->SetStringField(TEXT("symbolType"), TEXT("property"));
				PropJson->SetStringField(TEXT("className"), Class->GetName());
				return PropJson;
			}
		}
	}
	
	return nullptr;
}

TSharedPtr<FJsonObject> ReflectionQueryManager::GetCDODefaults(const FString& ClassName)
{
	UClass* Class = FindObject<UClass>(nullptr, *ClassName);
	if (!Class)
	{
		Class = LoadClass<UObject>(nullptr, *ClassName);
	}
	
	if (!Class)
	{
		return nullptr;
	}
	
	UObject* CDO = Class->GetDefaultObject();
	if (!CDO)
	{
		return nullptr;
	}
	
	TSharedPtr<FJsonObject> Result = MakeShareable(new FJsonObject);
	Result->SetStringField(TEXT("className"), ClassName);
	
	TSharedPtr<FJsonObject> Defaults = MakeShareable(new FJsonObject);
	
	// Iterate through properties and get their default values
	for (TFieldIterator<FProperty> PropIterator(Class); PropIterator; ++PropIterator)
	{
		FProperty* Property = *PropIterator;
		if (!Property)
		{
			continue;
		}
		
		FString PropertyName = Property->GetName();
		
		// Export property value as string (UE 5.6 API)
		// Note: ExportTextItem API changed in UE 5.6 - method signature is different
		// For now, we'll skip CDO default value export
		// TODO: Re-implement using correct UE 5.6 property export API
		// The correct method may be ExportTextItem_Direct or a different signature
		/*
		FString PropertyValue;
		void* DataPtr = Property->ContainerPtrToValuePtr<void>(CDO);
		if (DataPtr)
		{
			// UE 5.6: Need to find correct ExportTextItem signature
			// Property->ExportTextItem(...);
		}
		
		if (!PropertyValue.IsEmpty())
		{
			Defaults->SetStringField(PropertyName, PropertyValue);
		}
		*/
	}
	
	Result->SetObjectField(TEXT("defaults"), Defaults);
	
	return Result;
}

TSharedPtr<FJsonObject> ReflectionQueryManager::ClassToJson(UClass* Class)
{
	if (!Class)
	{
		return nullptr;
	}
	
	TSharedPtr<FJsonObject> ClassJson = MakeShareable(new FJsonObject);
	ClassJson->SetStringField(TEXT("name"), Class->GetName());
	ClassJson->SetStringField(TEXT("fullName"), Class->GetFullName());
	
	// Inheritance chain
	TArray<TSharedPtr<FJsonValue>> InheritanceChain;
	UClass* CurrentClass = Class;
	while (CurrentClass && CurrentClass != UObject::StaticClass())
	{
		InheritanceChain.Add(MakeShareable(new FJsonValueString(CurrentClass->GetName())));
		CurrentClass = CurrentClass->GetSuperClass();
	}
	ClassJson->SetArrayField(TEXT("inheritanceChain"), InheritanceChain);
	
	if (Class->GetSuperClass())
	{
		ClassJson->SetStringField(TEXT("super"), Class->GetSuperClass()->GetName());
	}
	
	// Metadata - UE 5.6: GetMetaDataMap() doesn't exist, iterate through known metadata keys
	TSharedPtr<FJsonObject> MetadataObject = MakeShareable(new FJsonObject);
	// Get common metadata keys
	TArray<FName> CommonKeys = { TEXT("BlueprintType"), TEXT("Blueprintable"), TEXT("Config"), TEXT("Category"), TEXT("Tooltip"), TEXT("Comment") };
	for (const FName& Key : CommonKeys)
	{
		FString Value = Class->GetMetaData(Key);
		if (!Value.IsEmpty())
		{
			MetadataObject->SetStringField(Key.ToString(), Value);
		}
	}
	ClassJson->SetObjectField(TEXT("metadata"), MetadataObject);
	
	// Module
	FString ModuleName = Class->GetOutermost()->GetName();
	ClassJson->SetStringField(TEXT("module"), ModuleName);
	
	return ClassJson;
}

TSharedPtr<FJsonObject> ReflectionQueryManager::FunctionToJson(UFunction* Function)
{
	if (!Function)
	{
		return nullptr;
	}
	
	TSharedPtr<FJsonObject> FuncJson = MakeShareable(new FJsonObject);
	FuncJson->SetStringField(TEXT("name"), Function->GetName());
	FuncJson->SetStringField(TEXT("fullName"), Function->GetFullName());
	
	// Return type
	FProperty* ReturnProp = Function->GetReturnProperty();
	if (ReturnProp)
	{
		FuncJson->SetStringField(TEXT("returnType"), ReturnProp->GetCPPType());
	}
	else
	{
		FuncJson->SetStringField(TEXT("returnType"), TEXT("void"));
	}
	
	// Parameters
	TArray<TSharedPtr<FJsonValue>> Parameters;
	for (TFieldIterator<FProperty> ParamIterator(Function); ParamIterator; ++ParamIterator)
	{
		FProperty* Param = *ParamIterator;
		if (Param && Param != ReturnProp)
		{
			TSharedPtr<FJsonObject> ParamJson = MakeShareable(new FJsonObject);
			ParamJson->SetStringField(TEXT("name"), Param->GetName());
			ParamJson->SetStringField(TEXT("type"), Param->GetCPPType());
			Parameters.Add(MakeShareable(new FJsonValueObject(ParamJson)));
		}
	}
	FuncJson->SetArrayField(TEXT("parameters"), Parameters);
	
	// Function flags
	TArray<TSharedPtr<FJsonValue>> Flags;
	if (Function->HasAnyFunctionFlags(FUNC_BlueprintCallable))
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("BlueprintCallable"))));
	}
	if (Function->HasAnyFunctionFlags(FUNC_BlueprintEvent))
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("BlueprintEvent"))));
	}
	if (Function->HasAnyFunctionFlags(FUNC_Net))
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("Net"))));
	}
	if (Function->HasAnyFunctionFlags(FUNC_NetReliable))
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("NetReliable"))));
	}
	if (Function->HasAnyFunctionFlags(FUNC_NetServer))
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("Server"))));
	}
	if (Function->HasAnyFunctionFlags(FUNC_NetClient))
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("Client"))));
	}
	if (Function->HasAnyFunctionFlags(FUNC_NetMulticast))
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("NetMulticast"))));
	}
	FuncJson->SetArrayField(TEXT("flags"), Flags);
	
	// Metadata - UE 5.6: GetMetaDataMap() doesn't exist, iterate through known metadata keys
	TSharedPtr<FJsonObject> MetadataObject = MakeShareable(new FJsonObject);
	// Get common metadata keys
	TArray<FName> CommonKeys = { TEXT("CallInEditor"), TEXT("Category"), TEXT("Tooltip"), TEXT("Comment"), TEXT("CustomThunk") };
	for (const FName& Key : CommonKeys)
	{
		FString Value = Function->GetMetaData(Key);
		if (!Value.IsEmpty())
		{
			MetadataObject->SetStringField(Key.ToString(), Value);
		}
	}
	FuncJson->SetObjectField(TEXT("metadata"), MetadataObject);
	
	// RPC info
	if (Function->HasAnyFunctionFlags(FUNC_Net))
	{
		TSharedPtr<FJsonObject> NetJson = MakeShareable(new FJsonObject);
		
		FString RPCType;
		if (Function->HasAnyFunctionFlags(FUNC_NetServer))
		{
			RPCType = TEXT("Server");
		}
		else if (Function->HasAnyFunctionFlags(FUNC_NetClient))
		{
			RPCType = TEXT("Client");
		}
		else if (Function->HasAnyFunctionFlags(FUNC_NetMulticast))
		{
			RPCType = TEXT("Multicast");
		}
		
		NetJson->SetStringField(TEXT("rpc"), RPCType);
		NetJson->SetBoolField(TEXT("reliable"), Function->HasAnyFunctionFlags(FUNC_NetReliable));
		
		FuncJson->SetObjectField(TEXT("net"), NetJson);
	}
	
	return FuncJson;
}

TSharedPtr<FJsonObject> ReflectionQueryManager::PropertyToJson(FProperty* Property)
{
	if (!Property)
	{
		return nullptr;
	}
	
	TSharedPtr<FJsonObject> PropJson = MakeShareable(new FJsonObject);
	PropJson->SetStringField(TEXT("name"), Property->GetName());
	PropJson->SetStringField(TEXT("cppType"), Property->GetCPPType());
	PropJson->SetStringField(TEXT("fullName"), Property->GetFullName());
	
	// Property flags - Correct Unreal reflection semantics
	// UPROPERTY specifiers are NOT EPropertyFlags - they translate to flags + metadata
	TArray<TSharedPtr<FJsonValue>> Flags;
	
	// Edit / EditAnywhere / EditDefaultsOnly / EditInstanceOnly
	const bool bEditable = Property->HasAnyPropertyFlags(CPF_Edit);
	if (bEditable)
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("Edit"))));
		
		// EditAnywhere = Edit && !EditDefaultsOnly && !EditInstanceOnly
		const bool bEditDefaultsOnly = Property->HasMetaData(TEXT("EditDefaultsOnly"));
		const bool bEditInstanceOnly = Property->HasMetaData(TEXT("EditInstanceOnly"));
		if (!bEditDefaultsOnly && !bEditInstanceOnly)
		{
			Flags.Add(MakeShareable(new FJsonValueString(TEXT("EditAnywhere"))));
		}
		else if (bEditDefaultsOnly)
		{
			Flags.Add(MakeShareable(new FJsonValueString(TEXT("EditDefaultsOnly"))));
		}
		else if (bEditInstanceOnly)
		{
			Flags.Add(MakeShareable(new FJsonValueString(TEXT("EditInstanceOnly"))));
		}
	}
	
	// Blueprint visibility
	const bool bBlueprintVisible = Property->HasAnyPropertyFlags(CPF_BlueprintVisible);
	const bool bBlueprintReadOnly = Property->HasAnyPropertyFlags(CPF_BlueprintReadOnly);
	
	if (bBlueprintReadOnly)
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("BlueprintReadOnly"))));
	}
	
	// BlueprintReadWrite = BlueprintVisible && !BlueprintReadOnly
	if (bBlueprintVisible && !bBlueprintReadOnly)
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("BlueprintReadWrite"))));
	}
	
	// Replication - Replicated is NOT a flag, it's CPF_Net
	const bool bReplicated = Property->HasAnyPropertyFlags(CPF_Net);
	if (bReplicated)
	{
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("Replicated"))));
		Flags.Add(MakeShareable(new FJsonValueString(TEXT("Net"))));
	}
	PropJson->SetArrayField(TEXT("flags"), Flags);
	
	// Metadata - UE 5.6: GetMetaDataMap() returns pointer, iterate through known keys
	TSharedPtr<FJsonObject> MetadataObject = MakeShareable(new FJsonObject);
	// Get common metadata keys
	TArray<FName> CommonKeys = { TEXT("Category"), TEXT("Tooltip"), TEXT("Comment"), TEXT("ReplicatedUsing"), TEXT("DisplayName") };
	for (const FName& Key : CommonKeys)
	{
		FString Value = Property->GetMetaData(Key);
		if (!Value.IsEmpty())
		{
			MetadataObject->SetStringField(Key.ToString(), Value);
		}
	}
	PropJson->SetObjectField(TEXT("metadata"), MetadataObject);
	
	// Category
	FString Category = Property->GetMetaData(TEXT("Category"));
	if (!Category.IsEmpty())
	{
		PropJson->SetStringField(TEXT("category"), Category);
	}
	
	// Replication - Replicated is CPF_Net, not CPF_Replicated
	if (Property->HasAnyPropertyFlags(CPF_Net))
	{
		TSharedPtr<FJsonObject> ReplicationJson = MakeShareable(new FJsonObject);
		ReplicationJson->SetBoolField(TEXT("enabled"), true);
		
		FString ReplicatedUsing = Property->GetMetaData(TEXT("ReplicatedUsing"));
		if (ReplicatedUsing.IsEmpty())
		{
			ReplicatedUsing = TEXT("None");
		}
		ReplicationJson->SetStringField(TEXT("condition"), ReplicatedUsing);
		
		PropJson->SetObjectField(TEXT("replication"), ReplicationJson);
	}
	
	return PropJson;
}


void ReflectionQueryManager::InvalidateCache()
{
	FScopeLock Lock(&CacheLock);
	ClassCache.Empty();
}


