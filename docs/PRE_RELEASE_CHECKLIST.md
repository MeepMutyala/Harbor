# Harbor Pre-Release Testing Checklist

Complete testing guide for validating Harbor before release. This ensures all installers work correctly across Chrome, Firefox, and Safari.

## Prerequisites

Before testing, ensure you have:
- [ ] macOS 12.0 or later
- [ ] Chrome, Firefox, and Safari installed
- [ ] Rust toolchain (`rustup`)
- [ ] Node.js 18+ and npm
- [ ] Xcode (for Safari builds)
- [ ] `installer/credentials.env` configured (copy from `credentials.env.example`)

## Phase 1: Clean Slate

Start from a completely clean state to ensure fresh installation testing.

### 1.1 Uninstall Everything

```bash
# Run the complete uninstaller (removes ALL Harbor installations)
sudo ./scripts/uninstall-all.sh --force-all
```

This removes:
- Chrome installer installation (`/Library/Application Support/Harbor/`)
- Firefox installer installation
- Safari app (`/Applications/Harbor.app`)
- Dev installations (native messaging manifests)
- User data (`~/.harbor/`)
- Caches and logs

### 1.2 Manual Browser Cleanup

After running the uninstaller, manually remove extensions from browsers:

**Chrome:**
1. Go to `chrome://extensions/`
2. Remove "Harbor" if present
3. Remove "Web Agents API" if present

**Firefox:**
1. Go to `about:addons`
2. Remove "Harbor" if present
3. Remove "Web Agents API" if present

**Safari:**
1. Safari → Settings → Extensions
2. Uncheck/remove Harbor extensions if still visible

### 1.3 Clean Build Artifacts

```bash
# Clean all installer build artifacts
./scripts/clean-build-artifacts.sh --all
```

### 1.4 Verify Clean State

Run these checks to confirm clean state:

```bash
# No Harbor directory
ls -la "/Library/Application Support/Harbor" 2>/dev/null && echo "FAIL: Harbor dir exists" || echo "OK: No Harbor dir"

# No Safari app
ls -la "/Applications/Harbor.app" 2>/dev/null && echo "FAIL: Safari app exists" || echo "OK: No Safari app"

# No native messaging manifests
ls -la ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/harbor*.json 2>/dev/null && echo "FAIL: Chrome manifests exist" || echo "OK: No Chrome manifests"
ls -la ~/Library/Application\ Support/Mozilla/NativeMessagingHosts/harbor*.json 2>/dev/null && echo "FAIL: Firefox manifests exist" || echo "OK: No Firefox manifests"

# No user data
ls -la ~/.harbor 2>/dev/null && echo "FAIL: User data exists" || echo "OK: No user data"
```

---

## Phase 2: Build Installers

Build all three installers from scratch.

### 2.1 Build Chrome Installer

```bash
cd installer/chrome
./build-pkg.sh --clean
```

**Expected output:**
- `installer/chrome/build/Harbor-Chrome-{version}.pkg`
- `installer/chrome/build/harbor-chrome.zip`
- `installer/chrome/build/web-agents-chrome.zip`

### 2.2 Build Firefox Installer

```bash
cd installer/firefox
./build-pkg.sh --clean
```

**Expected output:**
- `installer/firefox/build/Harbor-Firefox-{version}.pkg`
- `installer/firefox/build/harbor.xpi`
- `installer/firefox/build/web-agents.xpi`

### 2.3 Build Safari Installer

```bash
cd installer/safari
./build-installer.sh --clean release
```

**Expected output:**
- `installer/safari/build/output/Harbor-{version}.pkg`
- `installer/safari/build/output/Harbor.app`

---

## Phase 3: Test Chrome Installation

### 3.1 Install Chrome Package

```bash
sudo installer -pkg installer/chrome/build/Harbor-Chrome-*.pkg -target /
```

### 3.2 Post-Install Setup

The installer will launch a Setup Assistant. Follow the prompts to:
1. Open Chrome to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select `/Library/Application Support/Harbor/chrome-extension/`
4. Repeat for `/Library/Application Support/Harbor/web-agents-chrome/`
5. Note the extension IDs

### 3.3 Verify Installation

```bash
# Check bridge exists
ls -la "/Library/Application Support/Harbor/harbor-bridge"

# Check extensions exist
ls -la "/Library/Application Support/Harbor/chrome-extension/"
ls -la "/Library/Application Support/Harbor/web-agents-chrome/"

# Check native messaging manifest
ls -la "/Library/Application Support/Google/Chrome/NativeMessagingHosts/harbor_bridge.json"
```

### 3.4 Test Demo Pages (Chrome)

Start the demo server:
```bash
cd demo
npm install
npm start
```

Open Chrome and test each demo:

| Demo | URL | Test |
|------|-----|------|
| **Getting Started** | http://localhost:8000/web-agents/getting-started/ | Follow the tutorial |
| **Chat Demo** | http://localhost:8000/web-agents/chat-poc/ | Send a message, verify response |
| **Page Summarizer** | http://localhost:8000/web-agents/summarizer/ | Click summarize, verify output |
| **Basic Actions** | http://localhost:8000/web-agent-control/basic-actions/ | Test click, fill, select |
| **Multi-step Form** | http://localhost:8000/web-agent-control/multi-step-form/ | Complete form wizard |

**Checklist:**
- [ ] Permission prompt appears on first use
- [ ] `window.ai` is available in console
- [ ] `window.agent` is available in console
- [ ] Chat responses stream correctly
- [ ] Tool calls execute (if MCP servers connected)
- [ ] Sidebar opens and shows status

---

## Phase 4: Test Firefox Installation

### 4.1 Uninstall Chrome First (Optional)

To test Firefox in isolation:
```bash
sudo ./scripts/uninstall-all.sh --force
```

### 4.2 Install Firefox Package

```bash
sudo installer -pkg installer/firefox/build/Harbor-Firefox-*.pkg -target /
```

### 4.3 Install Extensions

The installer will open Firefox with the XPI files. Click "Add" for each:
- Harbor extension
- Web Agents API extension

Or manually install:
1. Open Firefox
2. Go to `about:addons`
3. Click gear → "Install Add-on From File..."
4. Select `/Library/Application Support/Harbor/harbor.xpi`
5. Repeat for `web-agents.xpi`

### 4.4 Verify Installation

```bash
# Check native messaging
ls -la "/Library/Application Support/Mozilla/NativeMessagingHosts/harbor_bridge.json"

# Check bridge
ls -la "/Library/Application Support/Harbor/harbor-bridge"
```

### 4.5 Test Demo Pages (Firefox)

Open Firefox and test the same demos:

| Demo | URL | Expected |
|------|-----|----------|
| Getting Started | http://localhost:8000/web-agents/getting-started/ | Tutorial works |
| Chat Demo | http://localhost:8000/web-agents/chat-poc/ | Chat works |
| Summarizer | http://localhost:8000/web-agents/summarizer/ | Summarization works |

**Checklist:**
- [ ] Permission prompt appears
- [ ] `window.ai` available
- [ ] `window.agent` available
- [ ] Sidebar works
- [ ] Chat responses stream

---

## Phase 5: Test Safari Installation

### 5.1 Uninstall Previous (Optional)

```bash
sudo ./scripts/uninstall-all.sh --force
```

### 5.2 Install Safari Package

```bash
sudo installer -pkg installer/safari/build/output/Harbor-*.pkg -target /
```

Or double-click the `.pkg` file.

### 5.3 Enable Extensions

1. Open Safari
2. Safari → Settings → Extensions
3. Check the boxes for:
   - **Harbor** (core extension)
   - **Web Agents API** (web page access)
4. Grant "Allow" permissions when prompted

**For unsigned builds (development):**
1. Safari → Develop → Allow Unsigned Extensions
2. Then enable extensions as above

### 5.4 Verify Installation

```bash
# Check app exists
ls -la "/Applications/Harbor.app"

# Check bridge inside app
ls -la "/Applications/Harbor.app/Contents/MacOS/harbor-bridge"
```

### 5.5 Test Demo Pages (Safari)

| Demo | URL | Expected |
|------|-----|----------|
| Getting Started | http://localhost:8000/web-agents/getting-started/ | Tutorial works |
| Chat Demo | http://localhost:8000/web-agents/chat-poc/ | Chat works |
| Summarizer | http://localhost:8000/web-agents/summarizer/ | Summarization works |

**Checklist:**
- [ ] Permission prompt appears
- [ ] `window.ai` available
- [ ] `window.agent` available
- [ ] Sidebar works
- [ ] Chat responses stream

---

## Phase 6: Cross-Browser Verification

If testing all browsers together:

### 6.1 Install All Three

```bash
# Install Chrome
sudo installer -pkg installer/chrome/build/Harbor-Chrome-*.pkg -target /

# Install Firefox
sudo installer -pkg installer/firefox/build/Harbor-Firefox-*.pkg -target /

# Install Safari
sudo installer -pkg installer/safari/build/output/Harbor-*.pkg -target /
```

### 6.2 Verify No Conflicts

- [ ] Chrome extension works after Firefox install
- [ ] Firefox extension works after Safari install
- [ ] All three browsers can use Harbor simultaneously
- [ ] Native bridge serves all browsers correctly

---

## Phase 7: Uninstall Testing

### 7.1 Test GUI Uninstaller

1. Open `/Applications/Uninstall Harbor.app`
2. Follow prompts
3. Verify removal

### 7.2 Test CLI Uninstaller

```bash
# Chrome/Firefox CLI uninstaller
sudo harbor-uninstall

# Or directly
sudo "/Library/Application Support/Harbor/uninstall.sh"
```

### 7.3 Test Complete Uninstaller

```bash
sudo ./scripts/uninstall-all.sh
```

**Checklist:**
- [ ] GUI uninstaller works
- [ ] CLI uninstaller works
- [ ] Complete uninstaller removes everything
- [ ] User data preserved by default
- [ ] `--force-all` removes user data

---

## Phase 8: Edge Cases

### 8.1 Fresh Install (No Previous Version)

- [ ] Installer works on machine that never had Harbor

### 8.2 Upgrade Path

1. Install old version (if available)
2. Install new version over it
3. Verify settings preserved
4. Verify extensions update

### 8.3 Reinstall After Uninstall

1. Install Harbor
2. Run uninstaller
3. Install Harbor again
4. Verify everything works

---

## Quick Test Script

For rapid smoke testing after builds:

```bash
#!/bin/bash
# quick-test.sh - Rapid smoke test

echo "Starting demo server..."
cd demo && npm start &
DEMO_PID=$!
sleep 3

echo ""
echo "Demo server running at http://localhost:8000"
echo ""
echo "Quick test URLs:"
echo "  - Getting Started: http://localhost:8000/web-agents/getting-started/"
echo "  - Chat Demo: http://localhost:8000/web-agents/chat-poc/"
echo "  - Summarizer: http://localhost:8000/web-agents/summarizer/"
echo ""
echo "Press Enter to stop the demo server..."
read
kill $DEMO_PID
```

---

## Release Checklist

Before creating a release:

- [ ] All Phase 1-7 tests pass
- [ ] Version numbers updated in manifests
- [ ] Changelog updated
- [ ] No uncommitted changes (except build artifacts)
- [ ] Git tag created
- [ ] Installers signed (if distributing)
- [ ] Installers notarized (if distributing outside App Store)

---

## Troubleshooting

### "Web Agent API not detected"
- Extension not installed or not enabled
- Reload the page after enabling extension

### Native bridge connection failed
- Check native messaging manifest exists
- Check bridge binary is executable
- Run bridge manually to see errors: `/Library/Application Support/Harbor/harbor-bridge --help`

### Safari extensions not showing
- Make sure Harbor.app is in /Applications
- Open the app once to register extensions
- Enable "Allow Unsigned Extensions" for dev builds

### Permission denied errors
- Run installer with `sudo`
- Check file permissions on Harbor directory
