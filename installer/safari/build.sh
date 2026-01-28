#!/bin/bash
# Safari Extension Build Script
# 
# This script builds the Harbor extension for Safari and packages it
# into a macOS app bundle using Xcode.
#
# Prerequisites:
# - Xcode installed
# - Apple Developer account (for code signing)
# - Run from the project root directory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EXTENSION_DIR="$PROJECT_ROOT/extension"
OUTPUT_DIR="$SCRIPT_DIR/build"

echo "=== Harbor Safari Extension Build ==="
echo ""

# Check for Xcode
if ! command -v xcodebuild &> /dev/null; then
    echo "Error: Xcode command line tools not found."
    echo "Please install Xcode from the App Store."
    exit 1
fi

# Build the extension for Safari
echo "Building extension for Safari..."
cd "$EXTENSION_DIR"
npm run build:safari

# Check if Xcode project exists
XCODE_PROJECT="$SCRIPT_DIR/Harbor/Harbor.xcodeproj"
if [ ! -d "$XCODE_PROJECT" ]; then
    echo ""
    echo "=== Xcode Project Not Found ==="
    echo ""
    echo "The Safari extension requires an Xcode project wrapper."
    echo "To create one:"
    echo ""
    echo "1. Open Xcode"
    echo "2. File > New > Project"
    echo "3. Select 'Safari Extension App' template"
    echo "4. Configure:"
    echo "   - Product Name: Harbor"
    echo "   - Team: Your Apple Developer Team"
    echo "   - Organization Identifier: org.harbor"
    echo "   - Language: Swift"
    echo "   - Include Tests: No"
    echo ""
    echo "5. Save the project to: $SCRIPT_DIR/Harbor/"
    echo ""
    echo "6. Copy extension files to the project:"
    echo "   cp -r $EXTENSION_DIR/dist \"$SCRIPT_DIR/Harbor/Harbor Extension/Resources/\""
    echo "   cp $EXTENSION_DIR/manifest.safari.json \"$SCRIPT_DIR/Harbor/Harbor Extension/Resources/manifest.json\""
    echo "   cp -r $EXTENSION_DIR/assets \"$SCRIPT_DIR/Harbor/Harbor Extension/Resources/\""
    echo ""
    echo "7. For native messaging support, add the harbor-bridge binary to the app bundle."
    echo ""
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Build with Xcode
echo ""
echo "Building with Xcode..."
xcodebuild -project "$XCODE_PROJECT" \
    -scheme "Harbor (macOS)" \
    -configuration Release \
    -archivePath "$OUTPUT_DIR/Harbor.xcarchive" \
    archive

echo ""
echo "=== Build Complete ==="
echo ""
echo "Archive created at: $OUTPUT_DIR/Harbor.xcarchive"
echo ""
echo "To export for distribution:"
echo "  xcodebuild -exportArchive \\"
echo "    -archivePath $OUTPUT_DIR/Harbor.xcarchive \\"
echo "    -exportPath $OUTPUT_DIR \\"
echo "    -exportOptionsPlist exportOptions.plist"
echo ""
echo "For App Store distribution, use Xcode Organizer or Transporter."
