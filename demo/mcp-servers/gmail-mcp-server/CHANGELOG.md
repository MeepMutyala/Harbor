# Changelog

All notable changes to this fork are documented in this file.

This is a fork of [@gongrzhe/server-gmail-autoauth-mcp](https://github.com/gongrzhe/server-gmail-autoauth-mcp).

---

## [Unreleased] - Fork Changes

### Added

#### External OAuth Token Support

**File changed:** `src/index.ts`

**What:** Added support for MCP hosts to provide OAuth tokens via environment variables, bypassing the file-based credential flow.

**Why:** Enables MCP hosts like Harbor to handle OAuth authentication on behalf of users. Users can authenticate with a single "Allow" click instead of creating their own Google Cloud project.

**Environment variables added:**

| Variable | Required | Description |
|----------|----------|-------------|
| `GMAIL_ACCESS_TOKEN` | Yes (to use this feature) | OAuth access token |
| `GMAIL_REFRESH_TOKEN` | No | Refresh token for auto-renewal |
| `GMAIL_CLIENT_ID` | No | Required if using refresh token |
| `GMAIL_CLIENT_SECRET` | No | Required if using refresh token |

**Code change:**

```typescript
// Added at the start of loadCredentials() function (lines 96-110)
async function loadCredentials() {
    // Check for externally-provided tokens (e.g., from Harbor or other MCP hosts)
    if (process.env.GMAIL_ACCESS_TOKEN) {
        oauth2Client = new OAuth2Client(
            process.env.GMAIL_CLIENT_ID,
            process.env.GMAIL_CLIENT_SECRET
        );
        oauth2Client.setCredentials({
            access_token: process.env.GMAIL_ACCESS_TOKEN,
            refresh_token: process.env.GMAIL_REFRESH_TOKEN,
            token_type: 'Bearer',
        });
        return;
    }

    // ... existing file-based credential loading unchanged ...
}
```

**Backward compatibility:** ✅ Full. Existing file-based authentication continues to work exactly as before. The new code path only activates when `GMAIL_ACCESS_TOKEN` is set.

---

## Upstream Version

This fork is based on `@gongrzhe/server-gmail-autoauth-mcp` version 1.1.11.

