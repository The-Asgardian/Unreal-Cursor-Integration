# Auto-install script for Unreal Engine Cursor Integration
# Installs both the Cursor extension and Unreal plugin for quick prototyping

param(
    [string]$UnrealProjectPath = "",
    [switch]$SkipExtension,
    [switch]$SkipPlugin,
    [bool]$RegenerateProjectFiles = $true
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Unreal Engine Cursor Integration Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Install Extension
if (-not $SkipExtension) {
    Write-Host "[1/2] Installing Cursor Extension..." -ForegroundColor Yellow
    
    $extensionPath = Join-Path $scriptRoot "cursor-extension"
    
    if (-not (Test-Path $extensionPath)) {
        Write-Host "ERROR: Extension directory not found: $extensionPath" -ForegroundColor Red
        exit 1
    }
    
    Push-Location $extensionPath
    
    try {
        # Check if node_modules exists, install if not
        if (-not (Test-Path "node_modules")) {
            Write-Host "  Installing npm dependencies..." -ForegroundColor Gray
            npm install
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed"
            }
        }
        
        # Compile TypeScript
        Write-Host "  Compiling TypeScript..." -ForegroundColor Gray
        npm run compile
        if ($LASTEXITCODE -ne 0) {
            throw "TypeScript compilation failed"
        }
        
        # Package extension
        Write-Host "  Packaging extension..." -ForegroundColor Gray
        npm run package
        if ($LASTEXITCODE -ne 0) {
            throw "Extension packaging failed"
        }
        
        # Find the .vsix file
        $vsixFile = Get-ChildItem -Path . -Filter "*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        
        if (-not $vsixFile) {
            throw "No .vsix file found after packaging"
        }
        
        Write-Host "  Found package: $($vsixFile.Name)" -ForegroundColor Gray
        
        # Try to install with Cursor first, fallback to code
        $cursorCmd = Get-Command "cursor" -ErrorAction SilentlyContinue
        $codeCmd = Get-Command "code" -ErrorAction SilentlyContinue
        
        if ($cursorCmd) {
            Write-Host "  Installing extension with Cursor..." -ForegroundColor Gray
            cursor --install-extension $vsixFile.FullName --force
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  [OK] Extension installed successfully!" -ForegroundColor Green
            } else {
                Write-Host "  [WARN] Cursor installation failed, trying VS Code..." -ForegroundColor Yellow
                if ($codeCmd) {
                    code --install-extension $vsixFile.FullName --force
                    if ($LASTEXITCODE -eq 0) {
                        Write-Host "  [OK] Extension installed with VS Code!" -ForegroundColor Green
                    } else {
                        throw "Extension installation failed"
                    }
                } else {
                    throw "Neither Cursor nor VS Code found in PATH"
                }
            }
        } elseif ($codeCmd) {
            Write-Host "  Installing extension with VS Code..." -ForegroundColor Gray
            code --install-extension $vsixFile.FullName --force
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  [OK] Extension installed successfully!" -ForegroundColor Green
            } else {
                throw "Extension installation failed"
            }
        } else {
            throw "Neither Cursor nor VS Code found in PATH. Please install one of them."
        }
        
    } catch {
        Write-Host "ERROR: $_" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    
    Pop-Location
    Write-Host ""
} else {
    Write-Host "[1/2] Skipping extension installation" -ForegroundColor Gray
    Write-Host ""
}

# Install Plugin
if (-not $SkipPlugin) {
    Write-Host "[2/2] Installing Unreal Engine Plugin..." -ForegroundColor Yellow
    
    # Get Unreal project path
    if ([string]::IsNullOrWhiteSpace($UnrealProjectPath)) {
        # Try to read from config file
        $configFile = Join-Path $scriptRoot ".unreal-project-path"
        if (Test-Path $configFile) {
            $UnrealProjectPath = Get-Content $configFile -Raw | ForEach-Object { $_.Trim() }
            Write-Host "  Using project path from config: $UnrealProjectPath" -ForegroundColor Gray
        } else {
            # Prompt for project path
            Write-Host "  Enter Unreal Engine project path (.uproject file):" -ForegroundColor Cyan
            $UnrealProjectPath = Read-Host "  Project path"
        }
    }
    
    if ([string]::IsNullOrWhiteSpace($UnrealProjectPath)) {
        Write-Host "ERROR: Unreal project path is required" -ForegroundColor Red
        exit 1
    }
    
    # Resolve path
    $resolvedPath = Resolve-Path $UnrealProjectPath -ErrorAction SilentlyContinue
    if (-not $resolvedPath) {
        Write-Host "ERROR: Invalid project path" -ForegroundColor Red
        exit 1
    }
    
    # Convert PathInfo to string
    $UnrealProjectPath = $resolvedPath.Path
    
    if (-not (Test-Path $UnrealProjectPath)) {
        Write-Host "ERROR: Project file not found: $UnrealProjectPath" -ForegroundColor Red
        exit 1
    }
    
    if (-not $UnrealProjectPath.EndsWith(".uproject")) {
        Write-Host "ERROR: Path must point to a .uproject file" -ForegroundColor Red
        exit 1
    }
    
    # Get project directory
    $projectDir = Split-Path -Parent $UnrealProjectPath
    $pluginsDir = Join-Path $projectDir "Plugins"
    $pluginTargetDir = Join-Path $pluginsDir "UnrealCursorBridge"
    
    # Create Plugins directory if it doesn't exist
    if (-not (Test-Path $pluginsDir)) {
        Write-Host "  Creating Plugins directory..." -ForegroundColor Gray
        New-Item -ItemType Directory -Path $pluginsDir -Force | Out-Null
    }
    
    # Copy plugin
    $pluginSourceDir = Join-Path $scriptRoot "unreal-plugin"
    
    if (-not (Test-Path $pluginSourceDir)) {
        Write-Host "ERROR: Plugin source directory not found: $pluginSourceDir" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "  Copying plugin to: $pluginTargetDir" -ForegroundColor Gray
    
    # Remove existing plugin if it exists
    if (Test-Path $pluginTargetDir) {
        Write-Host "  Removing existing plugin..." -ForegroundColor Gray
        try {
            Remove-Item -Path $pluginTargetDir -Recurse -Force -ErrorAction Stop
        }
        catch {
            # DLL might be locked if editor is running
            if ($_.Exception.Message -like "*denied*" -or $_.Exception.Message -like "*locked*") {
                Write-Host "  WARNING: Some plugin files are locked (Unreal Editor may be running)" -ForegroundColor Yellow
                Write-Host "  Attempting to remove unlocked files only..." -ForegroundColor Gray
                
                # Try to remove individual files/directories that aren't locked
                $items = Get-ChildItem -Path $pluginTargetDir -Recurse | Sort-Object -Property FullName -Descending
                foreach ($item in $items) {
                    try {
                        Remove-Item -Path $item.FullName -Force -ErrorAction Stop
                    }
                    catch {
                        # Skip locked files (like DLLs)
                        Write-Host "    Skipping locked file: $($item.Name)" -ForegroundColor DarkYellow
                    }
                }
                
                # Try to remove empty directories
                $dirs = Get-ChildItem -Path $pluginTargetDir -Recurse -Directory | Sort-Object -Property FullName -Descending
                foreach ($dir in $dirs) {
                    try {
                        if ((Get-ChildItem -Path $dir.FullName -Force | Measure-Object).Count -eq 0) {
                            Remove-Item -Path $dir.FullName -Force -ErrorAction Stop
                        }
                    }
                    catch {
                        # Skip if can't remove
                    }
                }
                
                Write-Host "  NOTE: Locked files (like .dll) will be replaced when editor is closed" -ForegroundColor Yellow
                Write-Host "  OR use Live Coding (Ctrl+Alt+F11) to hot-reload without restarting editor" -ForegroundColor Yellow
            }
            else {
                throw
            }
        }
    }
    
    # Copy plugin files
    Write-Host "  Copying plugin files..." -ForegroundColor Gray
    try {
        # Copy source files (these should always work)
        $sourceFiles = Get-ChildItem -Path $pluginSourceDir -Recurse -File
        $skippedFiles = @()
        
        foreach ($file in $sourceFiles) {
            $relativePath = $file.FullName.Substring($pluginSourceDir.Length + 1)
            $destPath = Join-Path $pluginTargetDir $relativePath
            $destDir = Split-Path -Parent $destPath
            
            # Create directory if needed
            if (-not (Test-Path $destDir)) {
                New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            }
            
            try {
                Copy-Item -Path $file.FullName -Destination $destPath -Force -ErrorAction Stop
            }
            catch {
                if ($_.Exception.Message -like "*denied*" -or $_.Exception.Message -like "*locked*") {
                    $skippedFiles += $relativePath
                    Write-Host "    Skipping locked file: $relativePath" -ForegroundColor DarkYellow
                }
                else {
                    throw
                }
            }
        }
        
        if ($skippedFiles.Count -gt 0) {
            Write-Host "  WARNING: Some files could not be copied (locked by editor):" -ForegroundColor Yellow
            foreach ($file in $skippedFiles) {
                Write-Host "    - $file" -ForegroundColor DarkYellow
            }
            Write-Host "  These will be updated when you close the editor or use Live Coding" -ForegroundColor Yellow
        }
        
        Write-Host "  [OK] Plugin files copied successfully!" -ForegroundColor Green
        
        if ($skippedFiles.Count -gt 0) {
            Write-Host "" -ForegroundColor Yellow
            Write-Host "  IMPORTANT: To apply locked file changes:" -ForegroundColor Yellow
            Write-Host "    1. Close Unreal Editor, OR" -ForegroundColor Yellow
            Write-Host "    2. Use Live Coding (Ctrl+Alt+F11) to hot-reload the plugin" -ForegroundColor Yellow
            Write-Host "" -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "ERROR: Failed to copy plugin files: $_" -ForegroundColor Red
        exit 1
    }
    
    # Save project path to config for next time
    $configFile = Join-Path $scriptRoot ".unreal-project-path"
    $UnrealProjectPath | Out-File -FilePath $configFile -Encoding utf8 -NoNewline
    Write-Host "  Saved project path to config for future use" -ForegroundColor Gray
    
    # Regenerate project files if requested
    if ($RegenerateProjectFiles) {
        Write-Host "  Regenerating project files..." -ForegroundColor Gray
        
        # Try to find UnrealVersionSelector
        $unrealVersionSelector = $null
        
        # Common Unreal Engine installation paths
        $unrealPaths = @(
            "C:\Program Files\Epic Games\UE_5.6\Engine\Binaries\DotNET\UnrealVersionSelector\UnrealVersionSelector.exe",
            "C:\Program Files\Epic Games\UE_5.5\Engine\Binaries\DotNET\UnrealVersionSelector\UnrealVersionSelector.exe",
            "C:\Program Files\Epic Games\UE_5.4\Engine\Binaries\DotNET\UnrealVersionSelector\UnrealVersionSelector.exe",
            "C:\Program Files\Epic Games\UE_5.3\Engine\Binaries\DotNET\UnrealVersionSelector\UnrealVersionSelector.exe"
        )
        
        foreach ($path in $unrealPaths) {
            if (Test-Path $path) {
                $unrealVersionSelector = $path
                break
            }
        }
        
        if ($unrealVersionSelector) {
            $process = Start-Process -FilePath $unrealVersionSelector -ArgumentList "/projectfiles", "`"$UnrealProjectPath`"" -Wait -PassThru -NoNewWindow
            if ($process.ExitCode -eq 0) {
                Write-Host "  [OK] Project files regenerated!" -ForegroundColor Green
            } else {
                Write-Host "  [WARN] Project file regeneration returned exit code $($process.ExitCode)" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  [WARN] UnrealVersionSelector not found. Please regenerate project files manually." -ForegroundColor Yellow
            Write-Host "     Right-click your .uproject file and select 'Generate Visual Studio project files'" -ForegroundColor Gray
        }
    }
    
    Write-Host ""
} else {
    Write-Host "[2/2] Skipping plugin installation" -ForegroundColor Gray
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Installation complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Reload Cursor/VS Code window (Ctrl+Shift+P then type 'Reload Window')" -ForegroundColor White
Write-Host "  2. Open your Unreal project in the Editor" -ForegroundColor White
Write-Host "  3. Verify the plugin is enabled (Edit menu -> Plugins)" -ForegroundColor White
Write-Host ""
