// Copyright Epic Games, Inc. All Rights Reserved.

using UnrealBuildTool;

public class UnrealCursorBridge : ModuleRules
{
	public UnrealCursorBridge(ReadTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;
		
		PublicIncludePaths.AddRange(
			new string[] {
			}
		);
				
		PrivateIncludePaths.AddRange(
			new string[] {
			}
		);
			
		PublicDependencyModuleNames.AddRange(
			new string[]
			{
				"Core",
				"CoreUObject",
				"Engine",
				"WebSockets",
				"Slate",
				"SlateCore"
			}
		);
			
		PrivateDependencyModuleNames.AddRange(
			new string[]
			{
				"AssetTools",
				"LiveCoding",
				"UnrealEd",
				"ToolMenus",
				"Json",
				"JsonUtilities"
			}
		);
		
		DynamicallyLoadedModuleNames.AddRange(
			new string[]
			{
			}
		);
	}
}

