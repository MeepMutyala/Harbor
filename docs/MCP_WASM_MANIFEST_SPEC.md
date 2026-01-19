# MCP WASM Server Manifest Specification

**Version:** 1.0.0  
**Status:** Draft

## Overview

The MCP WASM Manifest is a JSON file (`manifest.json`) that accompanies a WASM-compiled MCP server. It describes the server's metadata, required capabilities, and configuration needs.

Unlike the general [MCP Manifest Spec](./MCP_MANIFEST_SPEC.md) which handles installation from package registries (npm, pypi, docker), the WASM manifest is designed for self-contained WASM binaries that run in a sandboxed environment.

**Design principles:**
- **Self-describing** — All metadata and requirements in one file
- **Capability-based security** — Declare what the server needs, host enforces sandbox
- **Zero installation** — WASM binary + manifest is everything needed to run

## Package Structure

A WASM MCP server package consists of:

```
my-mcp-server/
├── manifest.json      # Required: server metadata and configuration
├── server.wasm        # Required: compiled WASM binary
└── README.md          # Optional: documentation
```

Or as a single archive:
```
my-mcp-server.mcpw     # .mcpw = MCP WASM package (zip archive)
```

## Minimal Example

```json
{
  "$schema": "https://harbor.dev/schemas/mcp-wasm-manifest.v1.json",
  "manifestVersion": "1.0.0",
  "name": "mcp-time",
  "version": "1.0.0",
  "description": "Get current time information"
}
```

That's it! If your server has no special requirements beyond stdio MCP communication, this is all you need.

## Full Example

```json
{
  "$schema": "https://harbor.dev/schemas/mcp-wasm-manifest.v1.json",
  "manifestVersion": "1.0.0",
  "name": "weather-api",
  "displayName": "Weather API Server",
  "version": "1.2.0",
  "description": "Get weather information for any location",
  "author": {
    "name": "Jane Developer",
    "email": "jane@example.com",
    "url": "https://github.com/jane"
  },
  "license": "MIT",
  "homepage": "https://github.com/jane/weather-mcp",
  "repository": "https://github.com/jane/weather-mcp",
  "keywords": ["weather", "forecast", "api"],

  "wasm": {
    "file": "server.wasm",
    "wasi": {
      "version": "preview1",
      "features": ["clocks"]
    },
    "memory": {
      "initial": 16,
      "maximum": 256
    }
  },

  "capabilities": {
    "network": {
      "required": true,
      "hosts": ["api.openweathermap.org"],
      "description": "Fetches weather data from OpenWeatherMap API"
    }
  },

  "environment": [
    {
      "name": "DEFAULT_UNITS",
      "description": "Temperature units (metric/imperial)",
      "type": "string",
      "default": "metric",
      "choices": ["metric", "imperial"]
    }
  ],

  "secrets": [
    {
      "name": "OPENWEATHERMAP_API_KEY",
      "description": "Your OpenWeatherMap API key",
      "required": true,
      "helpUrl": "https://openweathermap.org/api",
      "placeholder": "your-api-key-here"
    }
  ],

  "tools": [
    {
      "name": "weather.current",
      "description": "Get current weather for a location",
      "inputSchema": {
        "type": "object",
        "properties": {
          "location": {
            "type": "string",
            "description": "City name or coordinates"
          }
        },
        "required": ["location"]
      }
    },
    {
      "name": "weather.forecast",
      "description": "Get 5-day weather forecast",
      "inputSchema": {
        "type": "object",
        "properties": {
          "location": { "type": "string" },
          "days": { "type": "integer", "minimum": 1, "maximum": 5 }
        },
        "required": ["location"]
      }
    }
  ]
}
```

---

## Schema Reference

### Root Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `manifestVersion` | string | **Yes** | Always `"1.0.0"` |
| `name` | string | **Yes** | Machine-readable identifier (lowercase, hyphens) |
| `version` | string | **Yes** | Server version (semver) |
| `displayName` | string | No | Human-readable name |
| `description` | string | No | Brief description |
| `author` | string/object | No | Author info |
| `license` | string | No | SPDX license identifier |
| `homepage` | string | No | Project homepage URL |
| `repository` | string | No | Source repository URL |
| `keywords` | string[] | No | Keywords for discoverability |
| `wasm` | WasmConfig | No | WASM-specific settings |
| `capabilities` | Capabilities | No | Required host capabilities |
| `environment` | EnvVar[] | No | Non-secret env vars |
| `secrets` | Secret[] | No | API keys, tokens |
| `tools` | Tool[] | No | Tool declarations |
| `resources` | Resource[] | No | Resource declarations |
| `prompts` | Prompt[] | No | Prompt declarations |
| `signature` | Signature | No | Package signature |

---

### `author`

Can be a simple string or structured object:

```json
// Simple
"author": "Jane Developer <jane@example.com>"

// Structured
"author": {
  "name": "Jane Developer",
  "email": "jane@example.com",
  "url": "https://github.com/jane"
}
```

---

### `wasm`

WASM-specific configuration. All fields are optional with sensible defaults.

```json
{
  "wasm": {
    "file": "server.wasm",
    "wasi": {
      "version": "preview1",
      "features": ["clocks", "random"]
    },
    "memory": {
      "initial": 16,
      "maximum": 256
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `file` | string | `"server.wasm"` | Path to WASM file relative to manifest |
| `wasi.version` | enum | `"preview1"` | WASI version: `"preview1"` or `"preview2"` |
| `wasi.features` | string[] | `[]` | Additional WASI features: `"clocks"`, `"random"`, `"poll"` |
| `memory.initial` | integer | 16 | Initial memory in 64KB pages |
| `memory.maximum` | integer | — | Maximum memory in 64KB pages |

---

### `capabilities`

Declares what host capabilities the server needs. The host enforces these as a sandbox allowlist.

```json
{
  "capabilities": {
    "network": {
      "required": true,
      "hosts": ["api.example.com", "*.googleapis.com"],
      "description": "Fetches data from external APIs"
    },
    "filesystem": {
      "required": false,
      "read": true,
      "write": false,
      "paths": ["~/.config/my-server"],
      "description": "Reads configuration files"
    },
    "llm": {
      "required": false,
      "providers": ["local", "ollama"],
      "description": "Uses LLM for text summarization"
    }
  }
}
```

#### Network Capability

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `required` | boolean | `false` | Server won't work without network |
| `hosts` | string[] | `["*"]` | Allowed host patterns |
| `description` | string | — | Explain why network is needed |

**Host patterns:**
- `api.example.com` — exact match
- `*.example.com` — wildcard subdomain
- `*` — any host (requires explicit user approval)

#### Filesystem Capability

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `required` | boolean | `false` | Server won't work without filesystem |
| `read` | boolean | `true` | Needs read access |
| `write` | boolean | `false` | Needs write access |
| `paths` | string[] | — | Allowed paths/patterns |
| `description` | string | — | Explain why filesystem is needed |

**Path patterns:**
- `~/.config/my-server` — specific directory
- `~/Documents` — user's documents
- `$TMPDIR` — temp directory

#### LLM Capability

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `required` | boolean | `false` | Server won't work without LLM |
| `providers` | string[] | `["any"]` | Preferred providers in order |
| `description` | string | — | Explain why LLM is needed |

**Providers:** `"local"`, `"ollama"`, `"llamafile"`, `"openai"`, `"anthropic"`, `"any"`

---

### `environment`

Non-secret environment variables the server reads.

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
      "name": "MAX_RESULTS",
      "description": "Maximum number of results to return",
      "type": "number",
      "default": 10,
      "example": "25"
    },
    {
      "name": "ENABLE_CACHE",
      "description": "Enable response caching",
      "type": "boolean",
      "default": true
    }
  ]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | **Required** | Variable name (UPPER_SNAKE_CASE) |
| `description` | string | **Required** | Human-readable description |
| `required` | boolean | `false` | Must be set to start? |
| `type` | enum | `"string"` | `"string"`, `"number"`, `"boolean"`, `"url"` |
| `default` | any | — | Default value |
| `choices` | string[] | — | Allowed values (renders as dropdown) |
| `example` | string | — | Example value for docs |

---

### `secrets`

Secret credentials that need secure storage. The host stores these securely and injects them as environment variables.

```json
{
  "secrets": [
    {
      "name": "API_KEY",
      "description": "Your API key for the service",
      "required": true,
      "helpUrl": "https://example.com/api-keys",
      "pattern": "^[a-zA-Z0-9]{32}$",
      "placeholder": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    }
  ]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | **Required** | Env var name (UPPER_SNAKE_CASE) |
| `description` | string | **Required** | Human-readable description |
| `required` | boolean | `true` | Must be set to start? |
| `helpUrl` | string | — | Where to get this credential |
| `pattern` | string | — | Validation regex |
| `placeholder` | string | — | Input placeholder text |

---

### `tools`, `resources`, `prompts`

Optional static declarations of MCP capabilities. If omitted, these are discovered at runtime via MCP's `tools/list`, `resources/list`, and `prompts/list` methods.

**Why declare them statically?**
- Faster UI rendering (no need to start server to show tool list)
- Better discoverability in catalogs
- Documentation generation

```json
{
  "tools": [
    {
      "name": "search",
      "description": "Search for items",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string" }
        },
        "required": ["query"]
      }
    }
  ],
  "resources": [
    {
      "uri": "config://settings",
      "name": "Settings",
      "description": "Server configuration",
      "mimeType": "application/json"
    }
  ],
  "prompts": [
    {
      "name": "summarize",
      "description": "Summarize content",
      "arguments": [
        { "name": "content", "required": true }
      ]
    }
  ]
}
```

---

### `signature`

Digital signature for package integrity verification. Recommended for published packages.

```json
{
  "signature": {
    "algorithm": "ed25519",
    "value": "base64-encoded-signature...",
    "publicKey": "base64-encoded-public-key...",
    "keyId": "author@example.com"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `algorithm` | enum | **Yes** | `"ed25519"` or `"rsa-sha256"` |
| `value` | string | **Yes** | Base64-encoded signature of WASM file |
| `publicKey` | string | No | Base64-encoded public key or URL |
| `keyId` | string | No | Key identifier for lookup |

---

## Capability Model

WASM MCP servers run in a strict sandbox. Capabilities are **opt-in** and **enforced by the host**.

```
┌─────────────────────────────────────────────────────┐
│                    Host Environment                  │
│  ┌────────────────────────────────────────────────┐ │
│  │              WASM Sandbox                       │ │
│  │  ┌──────────────────────────────────────────┐  │ │
│  │  │           MCP Server (WASM)              │  │ │
│  │  │                                          │  │ │
│  │  │  stdio ←→ MCP Protocol                   │  │ │
│  │  └──────────────────────────────────────────┘  │ │
│  │                     │                          │ │
│  │       ┌─────────────┼─────────────┐           │ │
│  │       ▼             ▼             ▼           │ │
│  │   [Network]    [Filesystem]    [LLM]          │ │
│  │   (if granted) (if granted)   (if granted)   │ │
│  └────────────────────────────────────────────────┘ │
│                        │                             │
│            Host-mediated access only                 │
└─────────────────────────────────────────────────────┘
```

**Security properties:**
- WASM cannot access anything not explicitly granted
- Host validates all capability requests against manifest
- User must approve capabilities at install time
- Capabilities can be revoked at any time

---

## Common Patterns

### Simple Server (No External Access)

```json
{
  "manifestVersion": "1.0.0",
  "name": "calculator",
  "version": "1.0.0",
  "description": "Math operations",
  "tools": [
    { "name": "calculate", "description": "Evaluate math expression" }
  ]
}
```

### API Integration Server

```json
{
  "manifestVersion": "1.0.0",
  "name": "github-search",
  "version": "1.0.0",
  "description": "Search GitHub repositories",
  "capabilities": {
    "network": {
      "required": true,
      "hosts": ["api.github.com"]
    }
  },
  "secrets": [
    {
      "name": "GITHUB_TOKEN",
      "description": "GitHub personal access token",
      "required": false,
      "helpUrl": "https://github.com/settings/tokens"
    }
  ]
}
```

### Filesystem Access Server

```json
{
  "manifestVersion": "1.0.0",
  "name": "notes-manager",
  "version": "1.0.0",
  "description": "Manage local notes",
  "capabilities": {
    "filesystem": {
      "required": true,
      "read": true,
      "write": true,
      "paths": ["~/Documents/Notes"],
      "description": "Reads and writes notes in your Notes folder"
    }
  },
  "environment": [
    {
      "name": "NOTES_DIR",
      "description": "Notes directory (defaults to ~/Documents/Notes)",
      "type": "string",
      "default": "~/Documents/Notes"
    }
  ]
}
```

### LLM-Powered Server

```json
{
  "manifestVersion": "1.0.0",
  "name": "summarizer",
  "version": "1.0.0",
  "description": "Summarize text using LLM",
  "capabilities": {
    "llm": {
      "required": true,
      "providers": ["local", "ollama", "any"],
      "description": "Uses LLM to generate summaries"
    }
  }
}
```

---

## JSON Schema

Validate your manifest using the schema:

```json
{
  "$schema": "https://harbor.dev/schemas/mcp-wasm-manifest.v1.json",
  ...
}
```

Full schema available at `docs/schemas/mcp-wasm-manifest.v1.schema.json`.

---

## Migration from General MCP Manifest

If you have an existing MCP server with an [mcp-manifest.json](./MCP_MANIFEST_SPEC.md), here's how to create a WASM version:

| General Manifest | WASM Manifest |
|-----------------|---------------|
| `package.type: "npm"` | Not needed (WASM is self-contained) |
| `package.name` | Use `name` field |
| `runtime.hasNativeCode` | Not applicable (WASM is portable) |
| `execution.transport` | Always stdio for WASM |
| `environment` | Same structure |
| `secrets` | Same structure |
| `oauth` | Not supported in WASM (use `secrets` for tokens) |

---

## Publishing Guidelines

1. **Use semantic versioning** for the `version` field
2. **Sign your packages** using the `signature` field for published servers
3. **Minimize capabilities** — only request what you actually need
4. **Document why** you need each capability in the `description` fields
5. **Provide help URLs** for any secrets users need to obtain
6. **Declare tools statically** when possible for better UX
