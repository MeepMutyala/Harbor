# Gmail MCP Server - Harbor Compatible Version

This is a simplified version of the [Gmail MCP Server](https://github.com/r/Gmail-MCP-Server) that runs in Harbor's sandboxed JavaScript runtime.

## Quick Start

### Install Pre-built

Use the pre-built distributable manifest:

```
dist/gmail-harbor.manifest.json      # Full version (~20KB)
dist/gmail-harbor.min.manifest.json  # Minified (~15KB)
```

The manifest contains the server code embedded as base64, ready to load into Harbor.

### Build from Source

```bash
cd harbor
node build.js
```

This generates distributable manifests in `dist/`.

## Changes from Original

The original server uses Node.js-specific features that don't work in a browser-based Web Worker sandbox:

| Original | Harbor Version |
|----------|----------------|
| `googleapis` SDK | Direct `fetch()` calls to Gmail REST API |
| `@modelcontextprotocol/sdk` | Harbor's `MCP.readLine()` / `MCP.writeLine()` |
| `nodemailer` | Manual MIME message construction |
| Node.js `fs`, `path`, `os` | Not needed (Harbor manages OAuth) |
| Node.js `Buffer` | `btoa()` / `atob()` for base64 |
| `http` server for OAuth | Removed (Harbor handles OAuth externally) |

## Features

| Feature | Supported |
|---------|-----------|
| Search emails | ✅ |
| Read email content | ✅ |
| Send emails (text/HTML) | ✅ |
| List labels | ✅ |
| Modify labels | ✅ |
| Delete emails | ✅ |
| Attachments (send) | ❌ (no filesystem access) |
| Attachments (download) | ❌ (no filesystem access) |
| Batch operations | ❌ (not implemented) |
| Filters | ❌ (not implemented) |
| OAuth flow | ❌ (Harbor handles this) |

## Configuration

Harbor manages OAuth authentication externally. You need to configure:

```json
{
  "secrets": {
    "GMAIL_ACCESS_TOKEN": "your-oauth-access-token"
  }
}
```

Harbor will:
1. Handle the Google OAuth flow
2. Obtain and refresh tokens automatically
3. Inject `GMAIL_ACCESS_TOKEN` into the sandbox environment

## Manifest

The `manifest.json` declares:
- `runtime: "js"` — Runs in Harbor's JS sandbox
- `capabilities.network.hosts: ["gmail.googleapis.com"]` — Only Gmail API is accessible
- `secrets: ["GMAIL_ACCESS_TOKEN"]` — Required OAuth token

## Usage

1. Register the server in Harbor with the manifest
2. Configure Gmail OAuth in Harbor settings
3. Start the server
4. Use tools like `search_emails`, `read_email`, `send_email`

## Example Tool Calls

### Search Emails
```json
{
  "name": "search_emails",
  "arguments": {
    "query": "from:notifications@github.com after:2024/01/01",
    "maxResults": 5
  }
}
```

### Read Email
```json
{
  "name": "read_email",
  "arguments": {
    "messageId": "18abc123def"
  }
}
```

### Send Email
```json
{
  "name": "send_email",
  "arguments": {
    "to": ["recipient@example.com"],
    "subject": "Hello from Harbor",
    "body": "This email was sent via Harbor's Gmail MCP server."
  }
}
```

## Security

- Runs in isolated Web Worker
- Only `gmail.googleapis.com` network access allowed
- No filesystem access
- No extension API access
- OAuth tokens managed securely by Harbor

## Limitations

1. **No attachments** — The sandbox doesn't have filesystem access for reading/writing files
2. **No batch operations** — Simplified implementation
3. **No filters** — Not implemented in this version
4. **Token refresh** — Harbor must handle token refresh; the server doesn't have credentials to refresh tokens itself

## License

MIT (same as original)
