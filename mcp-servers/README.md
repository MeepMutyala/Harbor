# Harbor MCP Servers

This directory contains MCP (Model Context Protocol) servers for Harbor. MCP servers are tools that AI agents can use to interact with external services, APIs, and capabilities.

## Overview

Harbor supports two types of MCP servers:

| Type | Language | Best For |
|------|----------|----------|
| **JavaScript** | JavaScript | Quick prototypes, API wrappers, familiar ecosystem |
| **WASM** | Rust, Go, C++ | Production use, security-critical, high performance |

## Directory Structure

```
mcp-servers/
├── builtin/           # Built-in servers (auto-installed with Harbor)
│   ├── echo-js/       # JavaScript echo server (testing)
│   └── time-wasm/     # WASM time server (demo)
├── examples/          # Example servers showing real-world usage
│   └── gmail/         # Gmail API integration
└── templates/         # Starter templates for new servers
    ├── javascript/    # JavaScript server template
    └── wasm-rust/     # Rust WASM server template
```

## Included Servers

### Built-in Servers

These servers are automatically installed when you set up Harbor.

| Server | Type | Description | Tools |
|--------|------|-------------|-------|
| [echo-js](./builtin/echo-js/) | JavaScript | Testing and demo server | `echo`, `reverse` |
| [time-wasm](./builtin/time-wasm/) | WASM (Rust) | Returns current time | `time.now` |

### Example Servers

These servers demonstrate real-world integrations and patterns.

| Server | Type | Description | Tools |
|--------|------|-------------|-------|
| [gmail](./examples/gmail/) | JavaScript | Gmail API integration with OAuth | `search_emails`, `read_email`, `send_email`, `list_email_labels`, `modify_email`, `delete_email` |

## Installing Servers

### From Harbor UI

1. Open the Harbor sidebar in your browser
2. Go to "MCP Servers"
3. Click "Add Server"
4. Either:
   - Paste a manifest URL
   - Upload a manifest file
   - Browse the server catalog

### From Manifest URL

Servers can be installed from a URL pointing to their `manifest.json`:

```
https://example.com/my-mcp-server/manifest.json
```

### Local Development

For local development, you can load servers from the filesystem:

1. Point to a local manifest file in the Harbor settings
2. The server will be loaded and hot-reloaded on changes (for JS servers)

## Quick Start: Create Your Own Server

### JavaScript Server (5 minutes)

```bash
# Copy the template
cp -r mcp-servers/templates/javascript my-server
cd my-server

# Edit manifest.json with your server info
# Edit server.js with your tool implementations

# Test locally with Harbor
```

See [templates/javascript/](./templates/javascript/) for the full template.

### WASM Server (Rust)

```bash
# Copy the template
cp -r mcp-servers/templates/wasm-rust my-server
cd my-server

# Edit Cargo.toml and manifest.json
# Implement your tools in src/main.rs

# Build
cargo build --release --target wasm32-wasip1

# Test with Harbor
```

See [templates/wasm-rust/](./templates/wasm-rust/) for the full template.

## Writing MCP Servers

For comprehensive documentation on writing MCP servers, see:

- **[AUTHORING_GUIDE.md](./AUTHORING_GUIDE.md)** - Complete guide to writing MCP servers
- **[JS_MCP_SERVER_SPEC.md](../docs/JS_MCP_SERVER_SPEC.md)** - JavaScript server specification
- **[MCP_WASM_MANIFEST_SPEC.md](../docs/MCP_WASM_MANIFEST_SPEC.md)** - WASM manifest specification

## Server Capabilities

MCP servers can request various capabilities:

| Capability | Description | Example Use Case |
|------------|-------------|------------------|
| `network` | HTTP requests to specific hosts | API integrations |
| `filesystem` | Read/write local files | Note-taking apps |
| `llm` | Access to LLM providers | Text summarization |
| `oauth` | OAuth authentication flow | Google, GitHub APIs |

All capabilities are **opt-in** and require user approval.

## Security Model

Harbor MCP servers run in sandboxed environments:

- **JavaScript servers** run in isolated Web Workers with capability-restricted `fetch`
- **WASM servers** run in WASI sandboxes with host-mediated access

```
┌─────────────────────────────────────────────────────────────┐
│  Harbor Host                                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Capability Enforcer                                    │ │
│  │  - Validates network requests against manifest          │ │
│  │  - Injects secrets as environment variables             │ │
│  │  - Manages OAuth tokens                                 │ │
│  └──────────────────────────┬─────────────────────────────┘ │
│                              │                               │
│  ┌───────────────────────────▼───────────────────────────┐  │
│  │  Sandbox (Web Worker / WASI)                           │  │
│  │  ┌─────────────────────────────────────────────────┐   │  │
│  │  │  Your MCP Server                                │   │  │
│  │  │  - Only declared capabilities available         │   │  │
│  │  │  - No access to browser/extension APIs          │   │  │
│  │  └─────────────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Contributing

We welcome contributions! To add a new server:

1. Fork the repository
2. Create your server in `examples/` or propose it for `builtin/`
3. Include comprehensive documentation
4. Submit a pull request

## Resources

- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [Harbor Documentation](../docs/)
- [Example Demos](../demo/)
