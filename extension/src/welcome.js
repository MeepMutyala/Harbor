// Welcome page initialization

// Detect dark mode and set theme attribute
function detectTheme() {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
}

// Run immediately
detectTheme();

// Listen for theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', detectTheme);

// Get browser API
const browserAPI = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);

if (browserAPI) {
    // Mark first run as complete
    browserAPI.storage.local.set({ harbor_first_run_complete: true });
    
    // Get version from manifest and display it
    const manifest = browserAPI.runtime.getManifest();
    const versionBadge = document.getElementById('version-badge');
    if (versionBadge && manifest.version) {
        versionBadge.textContent = 'v' + manifest.version;
    }
    
    // Check runtime dependencies
    checkRuntimes();
}

async function checkRuntimes() {
    try {
        // Check runtimes via bridge
        const runtimesResponse = await browserAPI.runtime.sendMessage({ type: 'check_runtimes' });
        const dockerResponse = await browserAPI.runtime.sendMessage({ type: 'check_docker' });
        
        if (runtimesResponse && runtimesResponse.type === 'check_runtimes_result') {
            updateRuntimeStatus(runtimesResponse, dockerResponse);
        }
    } catch (err) {
        console.error('Failed to check runtimes:', err);
        // Show error state
        ['docker', 'python', 'node'].forEach(runtime => {
            const badge = document.getElementById(`${runtime}-status-badge`);
            if (badge) {
                badge.textContent = 'Error';
                badge.className = 'runtime-status unavailable';
            }
        });
    }
}

function updateRuntimeStatus(runtimesResponse, dockerResponse) {
    const runtimes = runtimesResponse.runtimes || [];
    
    // Docker (use dedicated docker check for more detail)
    const dockerBadge = document.getElementById('docker-status-badge');
    const dockerInstallPrompt = document.getElementById('docker-install-prompt');
    const dockerReadyMessage = document.getElementById('docker-ready-message');
    
    const dockerAvailable = dockerResponse && dockerResponse.available;
    if (dockerBadge) {
        if (dockerAvailable) {
            dockerBadge.textContent = `v${dockerResponse.version || 'ready'}`;
            dockerBadge.className = 'runtime-status available';
            if (dockerReadyMessage) dockerReadyMessage.style.display = 'block';
            if (dockerInstallPrompt) dockerInstallPrompt.style.display = 'none';
        } else {
            dockerBadge.textContent = 'Not installed';
            dockerBadge.className = 'runtime-status unavailable';
            if (dockerInstallPrompt) dockerInstallPrompt.style.display = 'block';
            if (dockerReadyMessage) dockerReadyMessage.style.display = 'none';
        }
    }
    
    // Python
    const pythonRuntime = runtimes.find(r => r.type === 'python');
    const pythonBadge = document.getElementById('python-status-badge');
    if (pythonBadge) {
        if (pythonRuntime && pythonRuntime.available) {
            pythonBadge.textContent = `v${pythonRuntime.version || 'ready'}`;
            pythonBadge.className = 'runtime-status available';
        } else if (dockerAvailable) {
            pythonBadge.textContent = 'Via Docker';
            pythonBadge.className = 'runtime-status optional';
        } else {
            pythonBadge.textContent = 'Not installed';
            pythonBadge.className = 'runtime-status unavailable';
        }
    }
    
    // Node.js
    const nodeRuntime = runtimes.find(r => r.type === 'node');
    const nodeBadge = document.getElementById('node-status-badge');
    if (nodeBadge) {
        if (nodeRuntime && nodeRuntime.available) {
            nodeBadge.textContent = `v${nodeRuntime.version || 'ready'}`;
            nodeBadge.className = 'runtime-status available';
        } else {
            nodeBadge.textContent = 'Bundled';
            nodeBadge.className = 'runtime-status optional';
        }
    }
    
    // Update capabilities summary
    updateCapabilitiesMessage(runtimesResponse, dockerAvailable);
}

function updateCapabilitiesMessage(runtimesResponse, dockerAvailable) {
    const runtimes = runtimesResponse.runtimes || [];
    const pythonRuntime = runtimes.find(r => r.type === 'python');
    const nodeRuntime = runtimes.find(r => r.type === 'node');
    
    const capabilitiesBox = document.getElementById('capabilities-message');
    const capabilitiesText = document.getElementById('capabilities-text');
    const missingWarning = document.getElementById('missing-warning');
    const missingWarningText = document.getElementById('missing-warning-text');
    
    const capabilities = [];
    const missing = [];
    
    if (dockerAvailable) {
        capabilities.push('✓ Run any MCP server in secure containers');
        capabilities.push('✓ Isolated execution with sandboxing');
    } else {
        missing.push('Docker enables running ANY MCP server securely. <a href="https://docker.com/products/docker-desktop/" target="_blank">Install Docker Desktop</a>');
    }
    
    if (pythonRuntime && pythonRuntime.available) {
        capabilities.push('✓ Run Python MCP servers natively');
    } else if (!dockerAvailable) {
        missing.push('Python servers require Python 3 or Docker');
    }
    
    // Node.js is always available via bundled bridge
    capabilities.push('✓ Run JavaScript MCP servers (bundled runtime)');
    
    if (capabilities.length > 0 && capabilitiesBox && capabilitiesText) {
        capabilitiesBox.style.display = 'block';
        capabilitiesText.innerHTML = capabilities.join('<br>');
    }
    
    if (missing.length > 0 && missingWarning && missingWarningText) {
        missingWarning.style.display = 'block';
        missingWarningText.innerHTML = missing.join('<br>');
    }
}

