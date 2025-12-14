// Copyright Epic Games, Inc. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"

// Placeholder for Phase 5: UHT + IntelliSense
class IntellisenseGenerator
{
public:
	static IntellisenseGenerator& Get();
	
	FString GenerateCompileCommands();
	void RunUHTCheck();

private:
	IntellisenseGenerator() = default;
	~IntellisenseGenerator() = default;
};

