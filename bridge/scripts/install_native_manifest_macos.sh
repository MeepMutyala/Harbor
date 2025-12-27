#!/bin/bash
# Install Harbor native messaging manifest for Firefox on macOS
# This script is idempotent - safe to run multiple times

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATE_PATH="$BRIDGE_DIR/harbor_bridge_host.json.template"
LAUNCHER_PATH="$SCRIPT_DIR/harbor_bridge_launcher.sh"

# Firefox native messaging hosts directory on macOS
MANIFEST_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
MANIFEST_PATH="$MANIFEST_DIR/com.harbor.bridge.json"

# Default extension ID (matches manifest.json)
DEFAULT_EXTENSION_ID="harbor@example.com"

# Check for extension ID argument
EXTENSION_ID="${1:-$DEFAULT_EXTENSION_ID}"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         Harbor Native Messaging Manifest Installer           ║"
echo "║                        (macOS)                               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Extension ID: $EXTENSION_ID"
echo ""

# Create the manifest directory if it doesn't exist
mkdir -p "$MANIFEST_DIR"
echo "✓ Manifest directory: $MANIFEST_DIR"

# Make the launcher executable
chmod +x "$LAUNCHER_PATH"
echo "✓ Launcher executable: $LAUNCHER_PATH"

# Generate the manifest from template
sed -e "s|__BRIDGE_LAUNCHER_PATH__|$LAUNCHER_PATH|g" \
    -e "s|__EXTENSION_ID__|$EXTENSION_ID|g" \
    "$TEMPLATE_PATH" > "$MANIFEST_PATH"

echo "✓ Manifest installed: $MANIFEST_PATH"
echo ""
echo "────────────────────────────────────────────────────────────────"
cat "$MANIFEST_PATH"
echo ""
echo "────────────────────────────────────────────────────────────────"
echo ""
echo "Installation complete!"
echo ""

# Check if uv is available
if ! command -v uv &> /dev/null; then
    echo "⚠  uv not found. Install it with:"
    echo ""
    echo "   curl -LsSf https://astral.sh/uv/install.sh | sh"
    echo ""
    echo "Then sync dependencies:"
    echo "   cd $BRIDGE_DIR && uv sync"
    echo ""
else
    # Check if dependencies are synced
    if [ ! -d "$BRIDGE_DIR/.venv" ]; then
        echo "⚠  Dependencies not synced. Run:"
        echo ""
        echo "   cd $BRIDGE_DIR && uv sync"
        echo ""
    fi
fi

echo "Next steps:"
echo "  1. Load extension in Firefox: about:debugging#/runtime/this-firefox"
echo "  2. Click 'Load Temporary Add-on' and select extension/dist/manifest.json"
echo "  3. Open the Harbor sidebar and click 'Send Hello'"
echo ""
echo "If using a different extension ID, re-run:"
echo "  $0 YOUR_EXTENSION_ID"
