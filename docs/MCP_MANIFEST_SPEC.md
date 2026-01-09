# MCP Server Manifest Specification

**Version:** 1.0.0  
**Status:** Draft

## Overview

The MCP Manifest is an **optional** JSON file that MCP server authors can include to help installation tools like Harbor automatically set up their servers.

**Design principles:**
- **Declarative** — Describe *what* is needed, not *how* to do it
- **Minimal** — Only include what's necessary for automated installation
- **Harbor provides the UX** — Harbor knows how to set up Google Cloud, GitHub OAuth, etc.

## File Location

Place `mcp-manifest.json` in your repository root.

Alternative locations (checked in order):
1. `mcp-manifest.json`
2. `.mcp/manifest.json`
3. `package.json` → `"mcp"` field

## Minimal Example

```json
{
  "manifestVersion": "1.0.0",
  "name": "My MCP Server",
  "package": {
    "type": "npm",
    "name": "@example/my-mcp-server"
  }
}
```

That's it! If your server has no special requirements, this is all you need.

## Full Example

For a server requiring OAuth and API keys:

```json
{
  "$schema": "https://harbor.dev/schemas/mcp-manifest.v1.json",
  "manifestVersion": "1.0.0",
  "name": "Gmail MCP Server",
  "description": "Read and send emails via Gmail API",
  "repository": "https://github.com/example/gmail-mcp",
  
  "package": {
    "type": "npm",
    "name": "@example/gmail-mcp-server",
    "alternatives": [
      {
        "type": "docker",
        "name": "gmail-mcp",
        "image": "ghcr.io/example/gmail-mcp:latest"
      }
    ]
  },

  "runtime": {
    "hasNativeCode": false
  },

  "secrets": [
    {
      "name": "OPENAI_API_KEY",
      "description": "OpenAI API key (optional, for email summarization)",
      "required": false,
      "helpUrl": "https://platform.openai.com/api-keys"
    }
  ],

  "oauth": {
    "provider": "google",
    "supportedSources": ["host", "user"],
    "preferredSource": "host",
    "description": "Access to read and send Gmail messages",
    "scopes": [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send"
    ],
    "apis": [
      {
        "name": "gmail.googleapis.com",
        "displayName": "Gmail API",
        "enableUrl": "https://console.cloud.google.com/apis/library/gmail.googleapis.com"
      }
    ],
    "hostMode": {
      "tokenEnvVar": "GMAIL_ACCESS_TOKEN",
      "refreshTokenEnvVar": "GMAIL_REFRESH_TOKEN"
    },
    "userMode": {
      "clientCredentialsPath": "~/.config/gmail-mcp/client-secret.json",
      "clientCredentialsEnvVar": "GMAIL_OAUTH_PATH",
      "tokenStoragePath": "~/.config/gmail-mcp/credentials.json",
      "tokenStorageEnvVar": "GMAIL_CREDENTIALS_PATH"
    }
  }
}
```

---

## Schema Reference

### Root Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `manifestVersion` | string | **Yes** | Always `"1.0.0"` |
| `name` | string | **Yes** | Display name |
| `description` | string | No | Brief description |
| `repository` | string | No | Source repository URL |
| `package` | Package | **Yes** | How to install |
| `runtime` | Runtime | No | Runtime characteristics |
| `execution` | Execution | No | How to run |
| `environment` | EnvVar[] | No | Non-secret env vars |
| `secrets` | Secret[] | No | API keys, tokens |
| `oauth` | OAuth | No | OAuth requirements |

---

### `package`

Where to get the server.

```json
{
  "package": {
    "type": "npm",
    "name": "@example/my-server"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum | **Yes** | `"npm"`, `"pypi"`, `"docker"`, `"binary"` |
| `name` | string | **Yes** | Package identifier |
| `image` | string | No | For docker: full image reference |
| `binaryUrl` | string | No | For binary: download URL (use `{os}`, `{arch}` placeholders) |
| `alternatives` | array | No | Fallback packages (same structure) |

**Examples:**

```json
// npm
{ "type": "npm", "name": "@modelcontextprotocol/server-filesystem" }

// pypi
{ "type": "pypi", "name": "mcp-server-time" }

// docker
{ "type": "docker", "name": "github-mcp", "image": "ghcr.io/github/github-mcp-server" }

// binary with platform placeholders
{ "type": "binary", "name": "my-server", "binaryUrl": "https://github.com/.../my-server-{os}-{arch}.tar.gz" }
```

---

### `runtime`

Runtime characteristics that affect installation decisions.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `hasNativeCode` | boolean | `false` | Has compiled/native code? (Docker may be preferred) |
| `minimumVersion` | string | — | Minimum runtime version |

**When to set `hasNativeCode: true`:**
- Node.js packages with native addons (node-gyp, nan, N-API)
- Python packages with C extensions (numpy, etc.)
- Any package that won't work cross-platform without compilation

---

### `execution`

How Harbor should run the server.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `transport` | enum | `"stdio"` | `"stdio"`, `"http"`, `"sse"` |
| `defaultPort` | number | — | For http/sse servers |

**Example:** HTTP server on a specific port:
```json
{
  "execution": {
    "transport": "http",
    "defaultPort": 8080
  }
}
```

---

### `environment`

Non-secret environment variables.

```json
{
  "environment": [
    {
      "name": "LOG_LEVEL",
      "description": "Logging verbosity",
      "type": "string",
      "default": "info",
      "choices": ["debug", "info", "warn", "error"]
    },
    {
      "name": "DATA_DIR",
      "description": "Directory for storing data",
      "type": "path",
      "required": true
    }
  ]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | **Required** | Variable name |
| `description` | string | **Required** | Human-readable description |
| `required` | boolean | `false` | Must be set to start? |
| `type` | enum | `"string"` | `"string"`, `"path"`, `"url"`, `"number"`, `"boolean"` |
| `default` | string | — | Default value |
| `choices` | string[] | — | Allowed values (renders as dropdown) |

---

### `secrets`

Secret credentials that need secure storage.

```json
{
  "secrets": [
    {
      "name": "OPENAI_API_KEY",
      "description": "Your OpenAI API key",
      "helpUrl": "https://platform.openai.com/api-keys",
      "pattern": "^sk-[a-zA-Z0-9]{48}$"
    }
  ]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | **Required** | Environment variable name |
| `description` | string | **Required** | Human-readable description |
| `required` | boolean | `true` | Must be set to start? |
| `helpUrl` | string | — | Where to get this credential |
| `pattern` | string | — | Validation regex |
| `placeholder` | string | — | Input placeholder text |

---

### `oauth`

OAuth requirements. If present, indicates this server needs OAuth.

```json
{
  "oauth": {
    "provider": "google",
    "supportedSources": ["host", "user"],
    "preferredSource": "host",
    "scopes": [
      "https://www.googleapis.com/auth/gmail.readonly"
    ],
    "apis": [
      {
        "name": "gmail.googleapis.com",
        "displayName": "Gmail API",
        "enableUrl": "https://console.cloud.google.com/apis/library/gmail.googleapis.com"
      }
    ],
    "hostMode": {
      "tokenEnvVar": "GMAIL_ACCESS_TOKEN",
      "refreshTokenEnvVar": "GMAIL_REFRESH_TOKEN"
    },
    "userMode": {
      "clientCredentialsPath": "~/.gmail-mcp/gcp-oauth.keys.json",
      "clientCredentialsEnvVar": "GMAIL_OAUTH_PATH",
      "tokenStoragePath": "~/.gmail-mcp/credentials.json",
      "tokenStorageEnvVar": "GMAIL_CREDENTIALS_PATH"
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | enum | **Yes** | `"google"`, `"github"`, `"microsoft"`, `"slack"`, `"custom"` |
| `supportedSources` | string[] | **Yes** | Which modes does the server support? `["host", "user", "server"]` |
| `preferredSource` | string | No | Preferred mode (defaults to first in `supportedSources`) |
| `scopes` | string[] | **Yes** | Required OAuth scopes |
| `description` | string | No | Human-readable description of what access is needed |
| `apis` | Api[] | No | APIs to enable (Google Cloud, etc.) |
| `hostMode` | object | No | Config for host-provided tokens (see below) |
| `userMode` | object | No | Config for user-provided credentials (see below) |
| `endpoints` | object | No | For custom providers: `{ authorization, token }` |

**`supportedSources` values:**

| Value | Meaning | Harbor Action |
|-------|---------|---------------|
| `"host"` | Server accepts tokens from the host | Harbor does OAuth, injects tokens as env vars |
| `"user"` | User must create their own app | Show setup wizard, prompt for credentials file |
| `"server"` | Server handles OAuth itself | No Harbor intervention |

**`hostMode` - when server supports host-provided tokens:**

| Field | Description |
|-------|-------------|
| `tokenEnvVar` | Env var for access token (e.g., `"GMAIL_ACCESS_TOKEN"`) |
| `refreshTokenEnvVar` | Env var for refresh token (e.g., `"GMAIL_REFRESH_TOKEN"`) |
| `clientIdEnvVar` | Env var for client ID (if server needs it for refresh) |
| `clientSecretEnvVar` | Env var for client secret (if server needs it) |

**`userMode` - when user creates their own OAuth app:**

| Field | Description |
|-------|-------------|
| `clientCredentialsPath` | Where to save the OAuth client JSON |
| `clientCredentialsEnvVar` | Env var server reads for credentials path |
| `tokenStoragePath` | Where server stores tokens after auth |
| `tokenStorageEnvVar` | Env var server reads for token path |

**`apis` array:**

For providers like Google that require explicit API enablement:

```json
{
  "apis": [
    {
      "name": "gmail.googleapis.com",
      "displayName": "Gmail API",
      "enableUrl": "https://console.cloud.google.com/apis/library/gmail.googleapis.com"
    }
  ]
}
```

Harbor will guide users to enable these APIs when using `"user"` mode.

---

## What Harbor Does With This

| Manifest Field | Harbor Action |
|----------------|---------------|
| `package.type: "npm"` | Run with `npx @example/server` |
| `package.type: "docker"` | Run with `docker run` |
| `runtime.hasNativeCode: true` | Prefer Docker on macOS; auto-retry with Docker if native fails |
| `environment[].type: "path"` | Show path picker |
| `secrets[]` | Show password input, secure storage |
| `oauth.provider: "google"` | Use Harbor's Google OAuth flow |
| `oauth.supportedSources: ["host"]` | Harbor handles OAuth, injects tokens |
| `oauth.supportedSources: ["user"]` | Show Google Cloud setup wizard |
| `oauth.apis[]` | Tell user which APIs to enable |

---

## Common Patterns

### Simple API Key Server

```json
{
  "manifestVersion": "1.0.0",
  "name": "OpenAI Server",
  "package": { "type": "npm", "name": "@example/openai-mcp" },
  "secrets": [
    {
      "name": "OPENAI_API_KEY",
      "description": "OpenAI API key",
      "helpUrl": "https://platform.openai.com/api-keys"
    }
  ]
}
```

### Server with Native Code

```json
{
  "manifestVersion": "1.0.0",
  "name": "SQLite Server",
  "package": { "type": "npm", "name": "@example/sqlite-mcp" },
  "runtime": { "hasNativeCode": true }
}
```

Harbor will automatically prefer Docker on macOS for servers with native code, and will auto-retry with Docker if native execution fails with security errors.

### Filesystem Server

```json
{
  "manifestVersion": "1.0.0",
  "name": "Filesystem Server",
  "package": { "type": "npm", "name": "@modelcontextprotocol/server-filesystem" }
}
```

Note: Harbor automatically handles filesystem servers appropriately - no special flags needed.

### GitHub OAuth Server

```json
{
  "manifestVersion": "1.0.0",
  "name": "GitHub Server",
  "package": { "type": "npm", "name": "@example/github-mcp" },
  "oauth": {
    "provider": "github",
    "supportedSources": ["host"],
    "scopes": ["repo", "read:user"]
  }
}
```

### Google API Server (User Creates App)

```json
{
  "manifestVersion": "1.0.0",
  "name": "Google Drive Server",
  "package": { "type": "npm", "name": "@example/gdrive-mcp" },
  "oauth": {
    "provider": "google",
    "supportedSources": ["user"],
    "scopes": ["https://www.googleapis.com/auth/drive.readonly"],
    "apis": [
      {
        "name": "drive.googleapis.com",
        "displayName": "Google Drive API",
        "enableUrl": "https://console.cloud.google.com/apis/library/drive.googleapis.com"
      }
    ],
    "userMode": {
      "clientCredentialsPath": "~/.config/gdrive-mcp/client-secret.json",
      "clientCredentialsEnvVar": "GDRIVE_CLIENT_SECRET_PATH",
      "tokenStoragePath": "~/.config/gdrive-mcp/tokens.json"
    }
  }
}
```

---

## JSON Schema

Validate your manifest:

```json
{
  "$schema": "https://harbor.dev/schemas/mcp-manifest.v1.json",
  ...
}
```

Full schema available at `docs/schemas/mcp-manifest.v1.schema.json`.
