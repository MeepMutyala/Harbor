# Harbor Safari Extension

This directory contains the build infrastructure for the Safari version of Harbor.

## Overview

Safari Web Extensions require a macOS app wrapper created in Xcode. The extension files (JavaScript, HTML, CSS) are bundled inside the app as resources.

## Prerequisites

1. **Xcode** (latest version recommended)
2. **Apple Developer Account** (for code signing)
3. **macOS 12.0+** (Monterey or later)

## Quick Start

### 1. Build the Extension

First, build the Safari version of the extension:

```bash
cd extension
npm run build:safari
```

This creates the `dist/` directory with Safari-compatible JavaScript bundles.

### 2. Create Xcode Project

Safari extensions require an Xcode project wrapper. Create one using Xcode:

1. Open Xcode
2. File → New → Project
3. Select "Safari Extension App" template (macOS tab)
4. Configure:
   - **Product Name**: Harbor
   - **Team**: Your Apple Developer Team
   - **Organization Identifier**: org.harbor
   - **Language**: Swift
   - **Include Tests**: No
5. Save to `installer/safari/Harbor/`

### 3. Copy Extension Files

Copy the built extension files to the Xcode project:

```bash
# From project root
cp -r extension/dist "installer/safari/Harbor/Harbor Extension/Resources/"
cp extension/manifest.safari.json "installer/safari/Harbor/Harbor Extension/Resources/manifest.json"
cp -r extension/assets "installer/safari/Harbor/Harbor Extension/Resources/"
cp -r extension/demo "installer/safari/Harbor/Harbor Extension/Resources/"
cp -r extension/bundled "installer/safari/Harbor/Harbor Extension/Resources/"
```

### 4. Build and Run

Build using the provided script or Xcode directly:

```bash
./build.sh
```

Or in Xcode:
1. Open `Harbor/Harbor.xcodeproj`
2. Select "Harbor (macOS)" scheme
3. Build and Run (⌘R)

## Native Messaging (Optional)

For full LLM functionality via the native bridge:

### App Extension Approach

Safari uses App Extensions for native messaging, which is more restrictive than Firefox/Chrome.

1. **Add a Native Helper Target**:
   - In Xcode, File → New → Target
   - Select "App Extension" or create a helper tool

2. **Bundle the Bridge Binary**:
   ```bash
   # Build the bridge
   cd bridge-rs
   cargo build --release
   
   # Copy to app bundle (done during Xcode build phase)
   ```

3. **Configure Entitlements**:
   - Add App Groups entitlement for IPC
   - Configure sandbox exceptions if needed

### Alternative: External Helper

For development, you can run the bridge as a separate process:

1. Build and install the bridge normally:
   ```bash
   cd bridge-rs
   ./install.sh
   ```

2. The extension will attempt to connect via alternative mechanisms.

## Distribution

### Development/Testing

1. Enable "Allow Unsigned Extensions" in Safari:
   - Safari → Develop → Allow Unsigned Extensions
   
2. Enable the extension in Safari Preferences → Extensions

### App Store Distribution

1. **Archive** the app in Xcode (Product → Archive)
2. **Validate** the archive for App Store
3. **Upload** via Xcode Organizer or Transporter
4. Submit for review in App Store Connect

### Direct Distribution (Developer ID)

1. Archive with "Developer ID" signing
2. Notarize the app:
   ```bash
   xcrun notarytool submit Harbor.zip --apple-id YOUR_ID --password APP_PASSWORD --team-id TEAM_ID
   ```
3. Staple the notarization ticket:
   ```bash
   xcrun stapler staple Harbor.app
   ```

## Project Structure

```
installer/safari/
├── README.md           # This file
├── build.sh           # Build script
└── Harbor/            # Xcode project (created manually)
    ├── Harbor.xcodeproj
    ├── Harbor/        # macOS app target
    │   ├── AppDelegate.swift
    │   ├── ViewController.swift
    │   └── ...
    └── Harbor Extension/  # Safari extension target
        ├── SafariWebExtensionHandler.swift
        └── Resources/
            ├── manifest.json    # Copied from manifest.safari.json
            ├── dist/            # Built extension files
            ├── assets/
            ├── demo/
            └── bundled/
```

## Differences from Firefox/Chrome

| Feature | Firefox/Chrome | Safari |
|---------|---------------|--------|
| Distribution | Self-hosted or store | App Store or notarized |
| Native Messaging | Separate manifest | App Extension |
| Sidebar | `sidebar_action` | Not supported |
| Permissions | Browser-based | System + browser |
| Updates | Extension store | App Store / direct |

## Troubleshooting

### "Extension not loaded"

1. Check Safari → Develop → Allow Unsigned Extensions
2. Verify manifest.json syntax
3. Check Xcode console for errors

### "Cannot connect to native messaging host"

1. Safari's App Extension messaging is more restrictive
2. Ensure proper entitlements are configured
3. Check sandboxing settings

### Build errors

1. Update Xcode to latest version
2. Check Swift/iOS SDK versions
3. Verify signing certificate is valid

## Resources

- [Safari Web Extensions Guide](https://developer.apple.com/documentation/safariservices/safari_web_extensions)
- [Converting a Chrome Extension](https://developer.apple.com/documentation/safariservices/safari_web_extensions/converting_a_web_extension_for_safari)
- [App Extension Programming Guide](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/)
