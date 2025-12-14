#!/bin/bash
# Auto-install script for Unreal Engine Cursor Integration
# Installs both the Cursor extension and Unreal plugin for quick prototyping

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
NC='\033[0m' # No Color

# Parse arguments
UNREAL_PROJECT_PATH=""
SKIP_EXTENSION=false
SKIP_PLUGIN=false
REGENERATE_PROJECT_FILES=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --project-path)
            UNREAL_PROJECT_PATH="$2"
            shift 2
            ;;
        --skip-extension)
            SKIP_EXTENSION=true
            shift
            ;;
        --skip-plugin)
            SKIP_PLUGIN=true
            shift
            ;;
        --no-regenerate)
            REGENERATE_PROJECT_FILES=false
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}Unreal Engine Cursor Integration Installer${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Install Extension
if [ "$SKIP_EXTENSION" = false ]; then
    echo -e "${YELLOW}[1/2] Installing Cursor Extension...${NC}"
    
    EXTENSION_PATH="$SCRIPT_ROOT/cursor-extension"
    
    if [ ! -d "$EXTENSION_PATH" ]; then
        echo -e "${RED}ERROR: Extension directory not found: $EXTENSION_PATH${NC}"
        exit 1
    fi
    
    cd "$EXTENSION_PATH"
    
    # Check if node_modules exists, install if not
    if [ ! -d "node_modules" ]; then
        echo -e "${GRAY}  Installing npm dependencies...${NC}"
        npm install
    fi
    
    # Compile TypeScript
    echo -e "${GRAY}  Compiling TypeScript...${NC}"
    npm run compile
    
    # Package extension
    echo -e "${GRAY}  Packaging extension...${NC}"
    npm run package
    
    # Find the .vsix file
    VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -n 1)
    
    if [ -z "$VSIX_FILE" ]; then
        echo -e "${RED}ERROR: No .vsix file found after packaging${NC}"
        exit 1
    fi
    
    echo -e "${GRAY}  Found package: $VSIX_FILE${NC}"
    
    # Try to install with Cursor first, fallback to code
    if command -v cursor &> /dev/null; then
        echo -e "${GRAY}  Installing extension with Cursor...${NC}"
        if cursor --install-extension "$VSIX_FILE" --force; then
            echo -e "${GREEN}  ✓ Extension installed successfully!${NC}"
        else
            echo -e "${YELLOW}  ⚠ Cursor installation failed, trying VS Code...${NC}"
            if command -v code &> /dev/null; then
                if code --install-extension "$VSIX_FILE" --force; then
                    echo -e "${GREEN}  ✓ Extension installed with VS Code!${NC}"
                else
                    echo -e "${RED}ERROR: Extension installation failed${NC}"
                    exit 1
                fi
            else
                echo -e "${RED}ERROR: Neither Cursor nor VS Code found in PATH${NC}"
                exit 1
            fi
        fi
    elif command -v code &> /dev/null; then
        echo -e "${GRAY}  Installing extension with VS Code...${NC}"
        if code --install-extension "$VSIX_FILE" --force; then
            echo -e "${GREEN}  ✓ Extension installed successfully!${NC}"
        else
            echo -e "${RED}ERROR: Extension installation failed${NC}"
            exit 1
        fi
    else
        echo -e "${RED}ERROR: Neither Cursor nor VS Code found in PATH. Please install one of them.${NC}"
        exit 1
    fi
    
    echo ""
else
    echo -e "${GRAY}[1/2] Skipping extension installation${NC}"
    echo ""
fi

# Install Plugin
if [ "$SKIP_PLUGIN" = false ]; then
    echo -e "${YELLOW}[2/2] Installing Unreal Engine Plugin...${NC}"
    
    # Get Unreal project path
    if [ -z "$UNREAL_PROJECT_PATH" ]; then
        # Try to read from config file
        CONFIG_FILE="$SCRIPT_ROOT/.unreal-project-path"
        if [ -f "$CONFIG_FILE" ]; then
            UNREAL_PROJECT_PATH=$(cat "$CONFIG_FILE" | tr -d '\n\r')
            echo -e "${GRAY}  Using project path from config: $UNREAL_PROJECT_PATH${NC}"
        else
            # Prompt for project path
            echo -e "${CYAN}  Enter Unreal Engine project path (.uproject file):${NC}"
            read -p "  Project path: " UNREAL_PROJECT_PATH
        fi
    fi
    
    if [ -z "$UNREAL_PROJECT_PATH" ]; then
        echo -e "${RED}ERROR: Unreal project path is required${NC}"
        exit 1
    fi
    
    # Resolve path
    if [ ! -f "$UNREAL_PROJECT_PATH" ]; then
        echo -e "${RED}ERROR: Project file not found: $UNREAL_PROJECT_PATH${NC}"
        exit 1
    fi
    
    if [[ ! "$UNREAL_PROJECT_PATH" == *.uproject ]]; then
        echo -e "${RED}ERROR: Path must point to a .uproject file${NC}"
        exit 1
    fi
    
    # Get project directory
    PROJECT_DIR=$(dirname "$(realpath "$UNREAL_PROJECT_PATH")")
    PLUGINS_DIR="$PROJECT_DIR/Plugins"
    PLUGIN_TARGET_DIR="$PLUGINS_DIR/UnrealCursorBridge"
    
    # Create Plugins directory if it doesn't exist
    if [ ! -d "$PLUGINS_DIR" ]; then
        echo -e "${GRAY}  Creating Plugins directory...${NC}"
        mkdir -p "$PLUGINS_DIR"
    fi
    
    # Copy plugin
    PLUGIN_SOURCE_DIR="$SCRIPT_ROOT/unreal-plugin"
    
    if [ ! -d "$PLUGIN_SOURCE_DIR" ]; then
        echo -e "${RED}ERROR: Plugin source directory not found: $PLUGIN_SOURCE_DIR${NC}"
        exit 1
    fi
    
    echo -e "${GRAY}  Copying plugin to: $PLUGIN_TARGET_DIR${NC}"
    
    # Remove existing plugin if it exists
    if [ -d "$PLUGIN_TARGET_DIR" ]; then
        echo -e "${GRAY}  Removing existing plugin...${NC}"
        rm -rf "$PLUGIN_TARGET_DIR"
    fi
    
    # Copy plugin files
    cp -r "$PLUGIN_SOURCE_DIR" "$PLUGIN_TARGET_DIR"
    
    echo -e "${GREEN}  ✓ Plugin copied successfully!${NC}"
    
    # Save project path to config for next time
    CONFIG_FILE="$SCRIPT_ROOT/.unreal-project-path"
    echo -n "$UNREAL_PROJECT_PATH" > "$CONFIG_FILE"
    echo -e "${GRAY}  Saved project path to config for future use${NC}"
    
    # Regenerate project files if requested
    if [ "$REGENERATE_PROJECT_FILES" = true ]; then
        echo -e "${GRAY}  Regenerating project files...${NC}"
        
        # On macOS/Linux, Unreal Editor typically handles this automatically
        # But we can try to find and use UnrealBuildTool if available
        echo -e "${YELLOW}  ⚠ Please regenerate project files manually if needed${NC}"
        echo -e "${GRAY}     The plugin will compile automatically when you open the project in Unreal Editor${NC}"
    fi
    
    echo ""
else
    echo -e "${GRAY}[2/2] Skipping plugin installation${NC}"
    echo ""
fi

echo -e "${CYAN}========================================${NC}"
echo -e "${GREEN}Installation complete!${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  ${NC}1. Reload Cursor/VS Code window (Ctrl+Shift+P -> 'Reload Window')"
echo -e "  ${NC}2. Open your Unreal project in the Editor"
echo -e "  ${NC}3. Verify the plugin is enabled (Edit -> Plugins)"
echo ""
