// Copyright Epic Games, Inc. All Rights Reserved.

#include "UHT/UHTMetadataExtractor.h"
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "HAL/PlatformFilemanager.h"
#include "Internationalization/Regex.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Serialization/JsonSerializer.h"

UHTMetadataExtractor& UHTMetadataExtractor::Get()
{
	static UHTMetadataExtractor Instance;
	return Instance;
}

bool UHTMetadataExtractor::ExtractFromGeneratedHeader(const FString& GeneratedHeaderPath, FUHTClassMetadata& OutMetadata)
{
	return ParseGeneratedHeader(GeneratedHeaderPath, OutMetadata);
}

TArray<FUHTClassMetadata> UHTMetadataExtractor::ExtractFromModule(const FString& ModuleName)
{
	TArray<FUHTClassMetadata> Results;
	
	TArray<FString> GeneratedHeaders = FindGeneratedHeaders(ModuleName);
	for (const FString& HeaderPath : GeneratedHeaders)
	{
		FUHTClassMetadata Metadata;
		if (ParseGeneratedHeader(HeaderPath, Metadata))
		{
			Results.Add(Metadata);
		}
	}
	
	return Results;
}

bool UHTMetadataExtractor::ParseGeneratedHeader(const FString& FilePath, FUHTClassMetadata& OutMetadata)
{
	FString FileContent;
	if (!FFileHelper::LoadFileToString(FileContent, *FilePath))
	{
		return false;
	}
	
	// Split into lines
	TArray<FString> Lines;
	FileContent.ParseIntoArrayLines(Lines);
	
	bool bFoundClass = false;
	
	for (const FString& Line : Lines)
	{
		FString TrimmedLine = Line.TrimStartAndEnd();
		
		// Look for class declaration: UCLASS(...) class MODULENAME_API ClassName : public SuperClass
		if (TrimmedLine.Contains(TEXT("UCLASS")) && TrimmedLine.Contains(TEXT("class")))
		{
			if (ParseClassDeclaration(TrimmedLine, OutMetadata))
			{
				bFoundClass = true;
			}
		}
		
		// Look for property declarations: UPROPERTY(...) Type PropertyName;
		if (TrimmedLine.Contains(TEXT("UPROPERTY")))
		{
			TSharedPtr<FJsonObject> Property;
			if (ParsePropertyDeclaration(TrimmedLine, Property))
			{
				OutMetadata.Properties.Add(Property);
			}
		}
		
		// Look for function declarations: UFUNCTION(...) ReturnType FunctionName(...);
		if (TrimmedLine.Contains(TEXT("UFUNCTION")))
		{
			TSharedPtr<FJsonObject> Function;
			if (ParseFunctionDeclaration(TrimmedLine, Function))
			{
				OutMetadata.Functions.Add(Function);
			}
		}
	}
	
	return bFoundClass;
}

bool UHTMetadataExtractor::ParseClassDeclaration(const FString& Line, FUHTClassMetadata& OutMetadata)
{
	// Pattern: UCLASS(metadata) class MODULENAME_API ClassName : public SuperClass
	// Example: UCLASS(BlueprintType, Config=Game) class MYGAME_API AMyActor : public AActor
	
	FString Pattern = TEXT("UCLASS\\(([^)]+)\\)\\s+class\\s+[A-Z_]+_API\\s+(\\w+)\\s*:\\s*public\\s+(\\w+)");
	FRegexMatcher Matcher(FRegexPattern(Pattern), Line);
	
	if (Matcher.FindNext())
	{
		FString MetadataStr = Matcher.GetCaptureGroup(1);
		OutMetadata.Name = Matcher.GetCaptureGroup(2);
		OutMetadata.Super = Matcher.GetCaptureGroup(3);
		OutMetadata.Metadata = ParseMetadata(MetadataStr);
		
		// Extract module name from the line (MODULENAME_API)
		FString ModulePattern = TEXT("class\\s+([A-Z_]+)_API");
		FRegexMatcher ModuleMatcher(FRegexPattern(ModulePattern), Line);
		if (ModuleMatcher.FindNext())
		{
			OutMetadata.Module = ModuleMatcher.GetCaptureGroup(1);
		}
		
		return true;
	}
	
	return false;
}

bool UHTMetadataExtractor::ParsePropertyDeclaration(const FString& Line, TSharedPtr<FJsonObject>& OutProperty)
{
	// Pattern: UPROPERTY(flags, metadata) Type PropertyName;
	// Example: UPROPERTY(EditAnywhere, BlueprintReadWrite, Replicated) float Health;
	
	FString Pattern = TEXT("UPROPERTY\\(([^)]+)\\)\\s+(\\w+(?:<[^>]+>)?(?:\\s*\\*)?)\\s+(\\w+)\\s*;");
	FRegexMatcher Matcher(FRegexPattern(Pattern), Line);
	
	if (Matcher.FindNext())
	{
		FString FlagsStr = Matcher.GetCaptureGroup(1);
		FString Type = Matcher.GetCaptureGroup(2).TrimStartAndEnd();
		FString Name = Matcher.GetCaptureGroup(3);
		
		TSharedPtr<FJsonObject> Property = MakeShareable(new FJsonObject);
		Property->SetStringField(TEXT("name"), Name);
		Property->SetStringField(TEXT("cppType"), Type);
		
		TArray<FString> Flags = ParseFlags(FlagsStr);
		TArray<TSharedPtr<FJsonValue>> FlagsArray;
		for (const FString& Flag : Flags)
		{
			FlagsArray.Add(MakeShareable(new FJsonValueString(Flag)));
		}
		Property->SetArrayField(TEXT("flags"), FlagsArray);
		
		// Parse metadata (Category, Replication, etc.)
		TMap<FString, FString> Metadata = ParseMetadata(FlagsStr);
		
		// Check for replication
		if (Flags.Contains(TEXT("Replicated")))
		{
			TSharedPtr<FJsonObject> Replication = MakeShareable(new FJsonObject);
			Replication->SetBoolField(TEXT("enabled"), true);
			
			FString Condition = Metadata.FindRef(TEXT("ReplicatedUsing"));
			if (Condition.IsEmpty())
			{
				Condition = TEXT("None");
			}
			Replication->SetStringField(TEXT("condition"), Condition);
			
			Property->SetObjectField(TEXT("replication"), Replication);
		}
		
		// Add category if present
		FString Category = Metadata.FindRef(TEXT("Category"));
		if (!Category.IsEmpty())
		{
			Property->SetStringField(TEXT("category"), Category);
		}
		
		OutProperty = Property;
		return true;
	}
	
	return false;
}

bool UHTMetadataExtractor::ParseFunctionDeclaration(const FString& Line, TSharedPtr<FJsonObject>& OutFunction)
{
	// Pattern: UFUNCTION(flags, metadata) ReturnType FunctionName(Params);
	// Example: UFUNCTION(BlueprintCallable, Server, Reliable) float TakeDamage(float Damage);
	
	FString Pattern = TEXT("UFUNCTION\\(([^)]+)\\)\\s+(\\w+(?:<[^>]+>)?(?:\\s*\\*)?)\\s+(\\w+)\\s*\\(([^)]*)\\)");
	FRegexMatcher Matcher(FRegexPattern(Pattern), Line);
	
	if (Matcher.FindNext())
	{
		FString FlagsStr = Matcher.GetCaptureGroup(1);
		FString ReturnType = Matcher.GetCaptureGroup(2).TrimStartAndEnd();
		FString Name = Matcher.GetCaptureGroup(3);
		FString Params = Matcher.GetCaptureGroup(4);
		
		TSharedPtr<FJsonObject> Function = MakeShareable(new FJsonObject);
		Function->SetStringField(TEXT("name"), Name);
		Function->SetStringField(TEXT("returnType"), ReturnType);
		
		TArray<FString> Flags = ParseFlags(FlagsStr);
		TArray<TSharedPtr<FJsonValue>> FlagsArray;
		for (const FString& Flag : Flags)
		{
			FlagsArray.Add(MakeShareable(new FJsonValueString(Flag)));
		}
		Function->SetArrayField(TEXT("flags"), FlagsArray);
		
		// Check for RPC
		if (Flags.Contains(TEXT("Server")) || Flags.Contains(TEXT("Client")) || Flags.Contains(TEXT("NetMulticast")))
		{
			TSharedPtr<FJsonObject> Net = MakeShareable(new FJsonObject);
			
			FString RPCType;
			if (Flags.Contains(TEXT("Server")))
			{
				RPCType = TEXT("Server");
			}
			else if (Flags.Contains(TEXT("Client")))
			{
				RPCType = TEXT("Client");
			}
			else if (Flags.Contains(TEXT("NetMulticast")))
			{
				RPCType = TEXT("Multicast");
			}
			
			Net->SetStringField(TEXT("rpc"), RPCType);
			Net->SetBoolField(TEXT("reliable"), Flags.Contains(TEXT("Reliable")));
			
			Function->SetObjectField(TEXT("net"), Net);
		}
		
		OutFunction = Function;
		return true;
	}
	
	return false;
}

TMap<FString, FString> UHTMetadataExtractor::ParseMetadata(const FString& MetadataString)
{
	TMap<FString, FString> Result;
	
	// Split by comma, but respect quoted strings
	TArray<FString> Parts;
	FString CurrentPart;
	bool bInQuotes = false;
	
	for (int32 i = 0; i < MetadataString.Len(); ++i)
	{
		TCHAR Char = MetadataString[i];
		
		if (Char == TEXT('"'))
		{
			bInQuotes = !bInQuotes;
			CurrentPart += Char;
		}
		else if (Char == TEXT(',') && !bInQuotes)
		{
			if (!CurrentPart.IsEmpty())
			{
				Parts.Add(CurrentPart.TrimStartAndEnd());
				CurrentPart.Empty();
			}
		}
		else
		{
			CurrentPart += Char;
		}
	}
	
	if (!CurrentPart.IsEmpty())
	{
		Parts.Add(CurrentPart.TrimStartAndEnd());
	}
	
	// Parse each part as key=value or just key
	for (const FString& Part : Parts)
	{
		FString Trimmed = Part.TrimStartAndEnd();
		
		// Check for key=value
		int32 EqualsPos = Trimmed.Find(TEXT("="));
		if (EqualsPos != INDEX_NONE)
		{
			FString Key = Trimmed.Left(EqualsPos).TrimStartAndEnd();
			FString Value = Trimmed.Mid(EqualsPos + 1).TrimStartAndEnd();
			
			// Remove quotes if present
			if (Value.StartsWith(TEXT("\"")) && Value.EndsWith(TEXT("\"")))
			{
				Value = Value.Mid(1, Value.Len() - 2);
			}
			
			Result.Add(Key, Value);
		}
		else
		{
			// Just a flag/key
			Result.Add(Trimmed, TEXT("true"));
		}
	}
	
	return Result;
}

TArray<FString> UHTMetadataExtractor::ParseFlags(const FString& FlagsString)
{
	TArray<FString> Flags;
	
	// Split by comma
	TArray<FString> Parts;
	FlagsString.ParseIntoArray(Parts, TEXT(","), true);
	
	for (const FString& Part : Parts)
	{
		FString Trimmed = Part.TrimStartAndEnd();
		
		// If it's key=value, extract just the key
		int32 EqualsPos = Trimmed.Find(TEXT("="));
		if (EqualsPos != INDEX_NONE)
		{
			Trimmed = Trimmed.Left(EqualsPos).TrimStartAndEnd();
		}
		
		if (!Trimmed.IsEmpty())
		{
			Flags.Add(Trimmed);
		}
	}
	
	return Flags;
}

TArray<FString> UHTMetadataExtractor::FindGeneratedHeaders(const FString& ModuleName)
{
	TArray<FString> Results;
	
	// Look in Intermediate/Build/.../Inc/{ModuleName}/
	FString ProjectDir = FPaths::GetPath(FPaths::GetProjectFilePath());
	FString IntermediateDir = FPaths::Combine(ProjectDir, TEXT("Intermediate"), TEXT("Build"));
	
	// Search for .generated.h files
	TArray<FString> FoundFiles;
	IFileManager::Get().FindFilesRecursive(FoundFiles, *IntermediateDir, TEXT("*.generated.h"), true, false);
	
	// Filter by module name
	for (const FString& FilePath : FoundFiles)
	{
		if (FilePath.Contains(ModuleName))
		{
			Results.Add(FilePath);
		}
	}
	
	// Also check Saved/ClangDB/ if it exists
	FString ClangDBDir = FPaths::Combine(ProjectDir, TEXT("Saved"), TEXT("ClangDB"));
	if (FPaths::DirectoryExists(ClangDBDir))
	{
		IFileManager::Get().FindFilesRecursive(FoundFiles, *ClangDBDir, TEXT("*.generated.h"), true, false);
		for (const FString& FilePath : FoundFiles)
		{
			if (FilePath.Contains(ModuleName) && !Results.Contains(FilePath))
			{
				Results.Add(FilePath);
			}
		}
	}
	
	return Results;
}

