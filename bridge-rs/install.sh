#!/bin/bash
# Harbor Bridge Installation Script
# Builds the bridge binary and installs the native messaging manifest

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY_NAME="harbor-bridge"

echo "=== Harbor Bridge Installer ==="
echo ""

# Detect OS
OS="$(uname -s)"
case "$OS" in
    Darwin)
        FIREFOX_MANIFEST_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
        CHROME_MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
        ;;
    Linux)
        FIREFOX_MANIFEST_DIR="$HOME/.mozilla/native-messaging-hosts"
        CHROME_MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
        ;;
    *)
        echo "Error: Unsupported OS: $OS"
        exit 1
        ;;
esac

# Build the release binary
echo "Building harbor-bridge..."
cd "$SCRIPT_DIR"
cargo build --release

BINARY_PATH="$SCRIPT_DIR/target/release/$BINARY_NAME"

if [ ! -f "$BINARY_PATH" ]; then
    echo "Error: Binary not found at $BINARY_PATH"
    exit 1
fi

echo "Binary built: $BINARY_PATH"
echo ""

# Create wrapper script that passes --native-messaging flag
WRAPPER_PATH="$SCRIPT_DIR/target/release/harbor-bridge-native"
cat > "$WRAPPER_PATH" << EOF
#!/bin/bash
exec "$BINARY_PATH" --native-messaging "\$@"
EOF
chmod +x "$WRAPPER_PATH"

echo "Created wrapper script: $WRAPPER_PATH"
echo ""

# Function to install manifest
install_manifest() {
    local browser="$1"
    local manifest_dir="$2"
    
    if [ -d "$(dirname "$manifest_dir")" ] || [ "$browser" = "Firefox" ]; then
        echo "Installing native messaging manifest for $browser..."
        mkdir -p "$manifest_dir"
        
        # Generate manifest with correct binary path
        cat > "$manifest_dir/harbor_bridge.json" << EOF
{
  "name": "harbor_bridge",
  "description": "Harbor Bridge - Local LLM and MCP server for Harbor extension",
  "path": "$WRAPPER_PATH",
  "type": "stdio",
  "allowed_extensions": ["harbor@anthropic.com"]
}
EOF
        echo "  Manifest installed: $manifest_dir/harbor_bridge.json"
    else
        echo "Skipping $browser (not installed)"
    fi
}

# Install for Firefox
install_manifest "Firefox" "$FIREFOX_MANIFEST_DIR"

# Install for Chrome (optional)
# install_manifest "Chrome" "$CHROME_MANIFEST_DIR"

echo ""
echo "=== Installation Complete ==="
echo ""
echo "The harbor-bridge will now start automatically when you open the Harbor extension."
echo ""
echo "To test manually, run:"
echo "  $BINARY_PATH"
echo ""
echo "Log file location:"
if [ "$OS" = "Darwin" ]; then
    echo "  ~/Library/Caches/harbor-bridge.log"
else
    echo "  ~/.cache/harbor-bridge.log"
fi
