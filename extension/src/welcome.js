// Welcome page initialization
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
}

