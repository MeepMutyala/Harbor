# Harbor Installer

Build distributable packages for Harbor.

## macOS (.pkg)

Creates a standard macOS installer package that:

1. **Checks requirements** - Firefox (required) and Docker (recommended)
2. **Installs the native bridge** - Standalone binary with bundled Node.js
3. **Installs the Firefox extension** - Signed XPI opened in Firefox
4. **Sets up native messaging** - So Firefox can communicate with the bridge
5. **Installs uninstaller** - Both GUI app and CLI

### User Dependencies

After installation, users only need:
- **Docker Desktop** - For running MCP servers
- **Firefox** - The browser

No Node.js or other development tools required!

### Quick Start

```bash
cd installer/macos
./build-pkg.sh --fast --sign-extension
```

The output will be at `installer/macos/build/Harbor-<version>.pkg`.

### Credentials Setup

Create `installer/credentials.env` (this file is gitignored):

```bash
# Mozilla Add-ons API credentials
# Get these from: https://addons.mozilla.org/developers/addon/api/key/
AMO_JWT_ISSUER="user:12345678:123"
AMO_JWT_SECRET="your-secret-here"

# Apple Developer (optional, for pkg signing/notarization)
DEVELOPER_ID="Your Name (XXXXXXXXXX)"
APPLE_ID="your@email.com"
APPLE_TEAM_ID="XXXXXXXXXX"
```

To get Mozilla credentials:
1. Go to https://addons.mozilla.org/developers/addon/api/key/
2. Create an API key
3. Copy the JWT issuer and secret

### Build Options

```bash
# Fast development build (current arch only, with extension signing)
./build-pkg.sh --fast --sign-extension

# Standard build (standalone binary with bundled Node.js)
./build-pkg.sh

# Sign the Firefox extension with Mozilla Add-ons
./build-pkg.sh --sign-extension

# Use system Node.js instead of bundling (smaller, but requires Node installed)
./build-pkg.sh --node

# Sign the .pkg package (requires Apple Developer ID)
./build-pkg.sh --sign

# Notarize for distribution (requires Apple credentials)
./build-pkg.sh --notarize

# Full production build (all signing options)
./build-pkg.sh --all

# Show help
./build-pkg.sh --help
```

### How the Build Works

1. **Downloads Node.js v20.19.6** - Specific version for building native modules
2. **Builds native modules** - `better-sqlite3` compiled for that exact Node version
3. **Bundles with esbuild** - All JavaScript into single file
4. **Packages with pkg** - Creates standalone binary with same Node.js v20.19.6 bundled
5. **Signs extension** - Uses Mozilla Add-ons API for trusted installation
6. **Creates .pkg** - Standard macOS installer with pre/post-install scripts

### Version Numbers

The build uses timestamp-based versions for development:
- Format: `0.YYMMDD.HHMM` (e.g., `0.260104.1501` = Jan 4, 2026 at 15:01)
- This ensures each build has a unique version for Mozilla Add-ons signing
- For releases, set `VERSION=1.0.0` environment variable

### Testing Locally

```bash
# Install the package
sudo installer -pkg build/Harbor-*.pkg -target /

# Check installation
ls -la "/Library/Application Support/Harbor/"

# Check native messaging manifest
cat "/Library/Application Support/Mozilla/NativeMessagingHosts/harbor_bridge_host.json"

# View installation log
cat /tmp/harbor-install.log

# Test the bridge binary directly
"/Library/Application Support/Harbor/harbor-bridge" </dev/null
```

### Uninstalling

**Option 1: GUI Uninstaller**
- Open "Uninstall Harbor" from `/Applications/` or use Spotlight

**Option 2: CLI (from anywhere)**
```bash
harbor-uninstall
```

**Option 3: Direct script**
```bash
# Interactive (prompts for confirmation)
sudo "/Library/Application Support/Harbor/uninstall.sh"

# Non-interactive, keeps user data
sudo "/Library/Application Support/Harbor/uninstall.sh" --force

# Non-interactive, removes everything including user data
sudo "/Library/Application Support/Harbor/uninstall.sh" --force-all
```

**What gets removed:**
- `/Library/Application Support/Harbor/` (bridge, extension, uninstaller)
- `/Library/Application Support/Mozilla/NativeMessagingHosts/harbor_bridge_host.json`
- `/Applications/Uninstall Harbor.app`
- `/usr/local/bin/harbor-uninstall`

**What is preserved by default:**
- `~/.harbor/` (your settings, databases, logs)
- The Firefox extension (must be removed manually)

**After uninstalling:**
1. Open Firefox
2. Go to `about:addons` (or menu → Add-ons and themes)
3. Find "Harbor" and click Remove

To manually remove user data:
```bash
rm -rf ~/.harbor
```

### Reinstalling During Development

```bash
# Option 1: Uninstall first
harbor-uninstall

# Option 2: Just clear package receipts (for clean reinstall)
sudo pkgutil --forget com.harbor.bridge

# Remove user-level native messaging manifest (if exists from dev setup)
rm -f ~/Library/Application\ Support/Mozilla/NativeMessagingHosts/harbor_bridge_host.json

# Install fresh
sudo installer -pkg build/Harbor-*.pkg -target /
```

### What Gets Installed

| Path | Description |
|------|-------------|
| `/Library/Application Support/Harbor/harbor-bridge` | Native bridge binary (standalone, includes Node.js) |
| `/Library/Application Support/Harbor/harbor.xpi` | Firefox extension (signed) |
| `/Library/Application Support/Harbor/uninstall.sh` | CLI uninstaller |
| `/Library/Application Support/Harbor/Uninstall Harbor.app` | GUI uninstaller |
| `/Library/Application Support/Mozilla/NativeMessagingHosts/harbor_bridge_host.json` | Native messaging manifest |
| `/Applications/Uninstall Harbor.app` | Uninstaller app (copied from Harbor dir) |
| `/usr/local/bin/harbor-uninstall` | CLI uninstaller symlink |
| `~/.harbor/` | User data directory (databases, logs, etc.) |

### Requirements for Building

- macOS 12+
- Node.js 18+ (for running build script; the build downloads its own Node for bundling)
- Xcode Command Line Tools (`xcode-select --install`)

For extension signing:
- Mozilla Add-ons API credentials (free)

For pkg signing/notarization:
- Apple Developer ID ($99/year)
- Keychain access configured for notarization

### Troubleshooting

**Extension shows "not verified"**
- Make sure you're using `--sign-extension` flag
- Check that credentials.env has valid AMO credentials
- Each version can only be signed once - the build uses timestamps to avoid conflicts

**Bridge won't connect**
- Check `~/.harbor/bridge.log` for errors
- Verify native messaging manifest exists: `cat "/Library/Application Support/Mozilla/NativeMessagingHosts/harbor_bridge_host.json"`
- Make sure Firefox was restarted after installation

**Permission errors with ~/.harbor**
- The installer should set correct permissions, but if not: `sudo chown -R $USER:staff ~/.harbor/`

**pkg build fails with native module errors**
- The build downloads a specific Node.js version (20.19.6) to ensure compatibility
- If you see ABI mismatch errors, try cleaning: `cd bridge-ts && rm -rf node_modules && npm install`

## Windows (.msi)

Coming soon.

## Linux (.deb, .rpm)

Coming soon.

## Architecture

```
User downloads .pkg
         │
         ▼
    ┌─────────────┐
    │ Pre-install │  Check Firefox installed
    └─────────────┘  Check Docker available
         │           Warn about architecture
         ▼
    ┌─────────────┐
    │   Payload   │  Copy harbor-bridge binary
    └─────────────┘  Copy harbor.xpi extension
         │           Copy uninstaller
         ▼
    ┌─────────────┐
    │ Post-install│  Create native messaging manifest
    └─────────────┘  Set up launcher script
         │           Open XPI in Firefox (triggers install prompt)
         ▼           Install uninstaller app
    User clicks "Add" in Firefox
         │
         ▼
    Extension connects to bridge via native messaging
         │
         ▼
    ✓ Ready to use!
```

## File Structure

```
installer/
├── credentials.env          # Your signing credentials (gitignored)
├── README.md               # This file
└── macos/
    ├── build-pkg.sh        # Main build script
    ├── distribution.xml    # Package distribution settings
    ├── resources/
    │   ├── welcome.html    # Installer welcome screen
    │   ├── license.html    # License agreement
    │   ├── conclusion.html # Post-install instructions
    │   └── uninstall-app.applescript
    ├── scripts/
    │   ├── preinstall      # Pre-installation checks
    │   ├── postinstall     # Post-installation setup
    │   └── uninstall.sh    # Uninstaller script
    └── build/              # Build output (gitignored)
        ├── Harbor-*.pkg    # Final installer
        ├── harbor-bridge   # Standalone binary
        └── harbor.xpi      # Signed extension
```
