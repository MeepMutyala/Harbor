#!/bin/bash
# Harbor - Configure Extension ID for Native Messaging
# Run this after loading the extension in Chrome developer mode
#
# Usage:
#   ./configure-extension-id.sh                    # Interactive mode
#   ./configure-extension-id.sh <extension_id>    # Direct mode
#   ./configure-extension-id.sh <harbor_id> <web_agents_id>  # Both extensions

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# Paths
HARBOR_DIR="/Library/Application Support/Harbor"
CONFIG_DIR="$HOME/.harbor"

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Harbor - Extension ID Configuration${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# =============================================================================
# Helper Functions
# =============================================================================

validate_extension_id() {
    local id="$1"
    # Chrome extension IDs are 32 lowercase letters (a-p only)
    if [[ "$id" =~ ^[a-p]{32}$ ]]; then
        return 0
    else
        return 1
    fi
}

find_manifest_files() {
    local manifests=()
    
    # System-level manifests (require sudo)
    local system_paths=(
        "/Library/Application Support/Google/Chrome/NativeMessagingHosts/harbor_bridge.json"
        "/Library/Application Support/Chromium/NativeMessagingHosts/harbor_bridge.json"
        "/Library/Application Support/Microsoft Edge/NativeMessagingHosts/harbor_bridge.json"
        "/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/harbor_bridge.json"
        "/Library/Application Support/Arc/User Data/NativeMessagingHosts/harbor_bridge.json"
        "/Library/Application Support/Vivaldi/NativeMessagingHosts/harbor_bridge.json"
    )
    
    # User-level manifests
    local user_paths=(
        "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/harbor_bridge.json"
        "$HOME/Library/Application Support/Chromium/NativeMessagingHosts/harbor_bridge.json"
        "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts/harbor_bridge.json"
        "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/harbor_bridge.json"
        "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts/harbor_bridge.json"
    )
    
    for path in "${system_paths[@]}" "${user_paths[@]}"; do
        if [ -f "$path" ]; then
            manifests+=("$path")
        fi
    done
    
    echo "${manifests[@]}"
}

update_manifest() {
    local manifest_path="$1"
    local origins_json="$2"
    
    python3 -c "
import json
import sys

manifest_path = '$manifest_path'
origins = json.loads('$origins_json')

try:
    with open(manifest_path, 'r') as f:
        data = json.load(f)
    
    data['allowed_origins'] = origins
    
    with open(manifest_path, 'w') as f:
        json.dump(data, f, indent=2)
    
    print('OK')
except Exception as e:
    print(f'ERROR: {e}', file=sys.stderr)
    sys.exit(1)
"
}

# =============================================================================
# Detect existing extension IDs from Chrome preferences
# =============================================================================

detect_extension_ids() {
    echo -e "${BLUE}Searching for Harbor extensions in Chrome...${NC}"
    echo ""
    
    local found_ids=()
    local prefs_file="$HOME/Library/Application Support/Google/Chrome/Default/Preferences"
    
    if [ -f "$prefs_file" ]; then
        # Look for extensions with "Harbor" in the name
        local ids=$(python3 -c "
import json
import sys

try:
    with open('$prefs_file', 'r') as f:
        prefs = json.load(f)
    
    extensions = prefs.get('extensions', {}).get('settings', {})
    
    for ext_id, ext_data in extensions.items():
        manifest = ext_data.get('manifest', {})
        name = manifest.get('name', '')
        path = ext_data.get('path', '')
        
        # Check if it's Harbor or Web Agents
        if 'harbor' in name.lower() or 'harbor' in path.lower():
            print(f'{ext_id}|{name}')
        elif 'web agents' in name.lower() or 'web-agents' in path.lower():
            print(f'{ext_id}|{name}')

except Exception as e:
    pass
" 2>/dev/null)
        
        if [ -n "$ids" ]; then
            echo -e "${GREEN}Found Harbor extension(s):${NC}"
            echo ""
            while IFS='|' read -r id name; do
                echo -e "  ${BOLD}$name${NC}"
                echo -e "  ID: ${CYAN}$id${NC}"
                echo ""
                found_ids+=("$id")
            done <<< "$ids"
            
            echo "${found_ids[@]}"
            return 0
        fi
    fi
    
    return 1
}

# =============================================================================
# Interactive Mode
# =============================================================================

interactive_mode() {
    echo "This script configures Chrome's native messaging to work with your"
    echo "Harbor extension loaded in Developer Mode."
    echo ""
    
    # Try to auto-detect
    local detected_ids
    detected_ids=$(detect_extension_ids 2>/dev/null) || true
    
    local harbor_id=""
    local web_agents_id=""
    
    if [ -n "$detected_ids" ]; then
        echo -e "${GREEN}✓ Auto-detected extension(s)${NC}"
        echo ""
        
        # Parse detected IDs
        read -ra id_array <<< "$detected_ids"
        
        if [ ${#id_array[@]} -ge 1 ]; then
            echo -e "Use detected Harbor extension ID? [${CYAN}${id_array[0]}${NC}]"
            read -p "(Press Enter to use, or type a different ID): " user_input
            
            if [ -z "$user_input" ]; then
                harbor_id="${id_array[0]}"
            else
                harbor_id="$user_input"
            fi
        fi
        
        if [ ${#id_array[@]} -ge 2 ]; then
            echo ""
            echo -e "Use detected Web Agents extension ID? [${CYAN}${id_array[1]}${NC}]"
            read -p "(Press Enter to use, or type a different ID, or 'skip'): " user_input
            
            if [ -z "$user_input" ]; then
                web_agents_id="${id_array[1]}"
            elif [ "$user_input" != "skip" ]; then
                web_agents_id="$user_input"
            fi
        fi
    fi
    
    # If no auto-detect, ask for input
    if [ -z "$harbor_id" ]; then
        echo -e "${YELLOW}Could not auto-detect extension IDs.${NC}"
        echo ""
        echo "To find your extension ID:"
        echo "  1. Open Chrome and go to chrome://extensions/"
        echo "  2. Find 'Harbor' in the list"
        echo "  3. Copy the 32-character ID below the extension name"
        echo ""
        echo -e "Example: ${CYAN}abcdefghijklmnopabcdefghijklmnop${NC}"
        echo ""
        
        while true; do
            read -p "Enter Harbor extension ID: " harbor_id
            
            if [ -z "$harbor_id" ]; then
                echo -e "${RED}Extension ID is required${NC}"
                continue
            fi
            
            if validate_extension_id "$harbor_id"; then
                break
            else
                echo -e "${RED}Invalid format. Extension IDs are 32 lowercase letters (a-p).${NC}"
            fi
        done
        
        echo ""
        read -p "Enter Web Agents extension ID (or press Enter to skip): " web_agents_id
    fi
    
    # Validate IDs
    if ! validate_extension_id "$harbor_id"; then
        echo -e "${YELLOW}Warning: Harbor ID format looks unusual, but continuing...${NC}"
    fi
    
    if [ -n "$web_agents_id" ] && ! validate_extension_id "$web_agents_id"; then
        echo -e "${YELLOW}Warning: Web Agents ID format looks unusual, but continuing...${NC}"
    fi
    
    configure_native_messaging "$harbor_id" "$web_agents_id"
}

# =============================================================================
# Configure Native Messaging Manifests
# =============================================================================

configure_native_messaging() {
    local harbor_id="$1"
    local web_agents_id="$2"
    
    echo ""
    echo -e "${BLUE}Configuring native messaging...${NC}"
    echo ""
    
    # Build allowed_origins JSON array
    local origins_json="[\"chrome-extension://$harbor_id/\""
    if [ -n "$web_agents_id" ]; then
        origins_json="$origins_json, \"chrome-extension://$web_agents_id/\""
    fi
    origins_json="$origins_json]"
    
    echo "Extension ID(s):"
    echo -e "  Harbor: ${CYAN}$harbor_id${NC}"
    if [ -n "$web_agents_id" ]; then
        echo -e "  Web Agents: ${CYAN}$web_agents_id${NC}"
    fi
    echo ""
    
    # Find and update manifest files
    local manifests
    manifests=$(find_manifest_files)
    
    if [ -z "$manifests" ]; then
        echo -e "${RED}No native messaging manifests found!${NC}"
        echo "Harbor may not have been installed correctly."
        exit 1
    fi
    
    local updated=0
    local need_sudo=false
    
    for manifest in $manifests; do
        # Check if it's a system-level manifest
        if [[ "$manifest" == /Library/* ]]; then
            need_sudo=true
        fi
    done
    
    if $need_sudo; then
        echo "Some manifests require administrator access."
        echo ""
    fi
    
    for manifest in $manifests; do
        local short_path="${manifest/#$HOME/~}"
        
        if [[ "$manifest" == /Library/* ]]; then
            # System manifest - need sudo
            if sudo python3 -c "
import json
manifest_path = '$manifest'
origins = $origins_json
with open(manifest_path, 'r') as f:
    data = json.load(f)
data['allowed_origins'] = origins
with open(manifest_path, 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null; then
                echo -e "  ${GREEN}✓${NC} $short_path"
                ((updated++))
            else
                echo -e "  ${RED}✗${NC} $short_path"
            fi
        else
            # User manifest - no sudo needed
            if python3 -c "
import json
manifest_path = '$manifest'
origins = $origins_json
with open(manifest_path, 'r') as f:
    data = json.load(f)
data['allowed_origins'] = origins
with open(manifest_path, 'w') as f:
    json.dump(data, f, indent=2)
" 2>/dev/null; then
                echo -e "  ${GREEN}✓${NC} $short_path"
                ((updated++))
            else
                echo -e "  ${RED}✗${NC} $short_path"
            fi
        fi
    done
    
    echo ""
    
    # Save configuration for future reference
    mkdir -p "$CONFIG_DIR"
    cat > "$CONFIG_DIR/extension-ids.env" << EOF
# Harbor Extension IDs (generated $(date))
CHROME_EXTENSION_ID="$harbor_id"
CHROME_WEB_AGENTS_EXTENSION_ID="$web_agents_id"
EOF
    
    if [ $updated -gt 0 ]; then
        echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
        echo ""
        echo -e "${GREEN}✓ Successfully updated $updated manifest(s)${NC}"
        echo ""
        echo -e "${BOLD}Next steps:${NC}"
        echo "  1. Quit Chrome completely (Cmd+Q)"
        echo "  2. Reopen Chrome"
        echo "  3. Click the Harbor icon (⚓) in the toolbar"
        echo ""
        echo -e "${YELLOW}Note:${NC} If you reload the extension, run this script again."
        echo ""
        echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
    else
        echo -e "${RED}No manifests were updated. Please check the errors above.${NC}"
        exit 1
    fi
}

# =============================================================================
# Main
# =============================================================================

# Check for command line arguments
if [ $# -ge 1 ]; then
    harbor_id="$1"
    web_agents_id="${2:-}"
    
    if ! validate_extension_id "$harbor_id"; then
        echo -e "${RED}Error: Invalid extension ID format${NC}"
        echo "Extension IDs are 32 lowercase letters (a-p only)"
        exit 1
    fi
    
    configure_native_messaging "$harbor_id" "$web_agents_id"
else
    interactive_mode
fi
