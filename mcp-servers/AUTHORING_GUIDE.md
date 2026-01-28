# MCP Server Authoring Guide

This guide explains how to write MCP (Model Context Protocol) servers for Harbor. Whether you're building a quick prototype or a production-ready integration, this document covers everything you need to know.

## Table of Contents

1. [Choosing a Runtime](#choosing-a-runtime)
2. [JavaScript Servers](#javascript-servers)
3. [WASM Servers (Rust)](#wasm-servers-rust)
4. [Manifest Reference](#manifest-reference)
5. [MCP Protocol Basics](#mcp-protocol-basics)
6. [Adding Capabilities](#adding-capabilities)
7. [OAuth Integration](#oauth-integration)
8. [Testing Your Server](#testing-your-server)
9. [Publishing](#publishing)

---

## Choosing a Runtime

Harbor supports two server runtimes:

| | JavaScript | WASM (Rust) |
|---|---|---|
| **Development Speed** | Fast - no build step | Slower - requires compilation |
| **Ecosystem** | npm packages (bundled) | Cargo crates |
| **Performance** | Good | Excellent |
| **Security** | Good (Web Worker) | Excellent (WASI sandbox) |
| **Best For** | API wrappers, prototypes | Production, security-critical |

**Choose JavaScript if:**
- You want to iterate quickly
- You're wrapping an HTTP API
- You're comfortable with JavaScript

**Choose WASM if:**
- You need maximum security
- You need high performance
- You're building for production

---

## JavaScript Servers

### Minimal Example

```javascript
async function main() {
  while (true) {
    const line = await MCP.readLine();
    const request = JSON.parse(line);
    
    let response;
    
    if (request.method === 'tools/list') {
      response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [{
            name: 'greet',
            description: 'Say hello to someone',
            inputSchema: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Name to greet' }
              },
              required: ['name']
            }
          }]
        }
      };
    } else if (request.method === 'tools/call') {
      const name = request.params?.arguments?.name || 'World';
      response = {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{ type: 'text', text: `Hello, ${name}!` }]
        }
      };
    } else {
      response = {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: 'Method not found' }
      };
    }
    
    MCP.writeLine(JSON.stringify(response));
  }
}

main().catch(console.error);
```

### Available Globals

| Global | Description |
|--------|-------------|
| `MCP.readLine()` | Read next JSON-RPC request (returns Promise) |
| `MCP.writeLine(str)` | Write JSON-RPC response |
| `fetch(url, opts)` | Proxied fetch (only allowed hosts) |
| `process.env` | Environment variables and secrets |
| `console.*` | Logging (forwarded to host) |
| `JSON`, `crypto`, `TextEncoder`, `URL` | Standard globals |

### Blocked Globals

These are removed from the sandbox:
- `fetch` (original) - replaced with proxied version
- `XMLHttpRequest`, `WebSocket` - use `fetch` instead
- `importScripts` - bundle your dependencies
- `chrome.*` - extension APIs not available

### Making API Requests

```javascript
// Only works if 'api.example.com' is in manifest capabilities
const response = await fetch('https://api.example.com/data', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ query: 'hello' })
});

const data = await response.json();
```

### Bundling Dependencies

Since `importScripts` is disabled, bundle your dependencies:

```bash
# Using esbuild (recommended)
esbuild src/server.js --bundle --format=iife --outfile=dist/server.js

# Using rollup
rollup src/server.js --file dist/server.js --format=iife
```

### JavaScript Manifest

```json
{
  "$schema": "https://harbor.dev/schemas/mcp-wasm-manifest.v1.json",
  "manifestVersion": "1.0.0",
  "id": "my-js-server",
  "name": "My Server",
  "version": "1.0.0",
  "description": "A JavaScript MCP server",
  "runtime": "js",
  "scriptUrl": "server.js",
  
  "capabilities": {
    "network": {
      "required": true,
      "hosts": ["api.example.com"]
    }
  },
  
  "secrets": [
    {
      "name": "API_KEY",
      "description": "Your API key",
      "required": true
    }
  ],
  
  "tools": [
    {
      "name": "my_tool",
      "description": "Does something useful",
      "inputSchema": {
        "type": "object",
        "properties": {
          "input": { "type": "string" }
        },
        "required": ["input"]
      }
    }
  ]
}
```

---

## WASM Servers (Rust)

### Project Setup

```bash
# Create new project
cargo new --name my-mcp-server .

# Add wasm target
rustup target add wasm32-wasip1

# Add dependencies to Cargo.toml
```

**Cargo.toml:**
```toml
[package]
name = "my-mcp-server"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

[profile.release]
opt-level = "s"
lto = true
```

### Minimal Example

```rust
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};

#[derive(Deserialize)]
struct Request {
    id: serde_json::Value,
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

#[derive(Serialize)]
struct Response {
    jsonrpc: &'static str,
    id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Serialize)]
struct RpcError {
    code: i64,
    message: String,
}

fn main() {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(raw) = line else { continue };
        if raw.trim().is_empty() { continue }
        
        let request: Request = match serde_json::from_str(&raw) {
            Ok(r) => r,
            Err(_) => {
                write_error(serde_json::Value::Null, -32700, "Parse error");
                continue;
            }
        };
        
        handle_request(request);
    }
}

fn handle_request(req: Request) {
    match req.method.as_str() {
        "tools/list" => {
            let result = serde_json::json!({
                "tools": [{
                    "name": "greet",
                    "description": "Say hello",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string" }
                        },
                        "required": ["name"]
                    }
                }]
            });
            write_result(req.id, result);
        }
        "tools/call" => {
            let name = req.params
                .get("arguments")
                .and_then(|a| a.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("World");
            
            let result = serde_json::json!({
                "content": [{ "type": "text", "text": format!("Hello, {}!", name) }]
            });
            write_result(req.id, result);
        }
        _ => write_error(req.id, -32601, "Method not found"),
    }
}

fn write_result(id: serde_json::Value, result: serde_json::Value) {
    let response = Response {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    };
    let mut out = io::stdout().lock();
    serde_json::to_writer(&mut out, &response).ok();
    writeln!(out).ok();
    out.flush().ok();
}

fn write_error(id: serde_json::Value, code: i64, message: &str) {
    let response = Response {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(RpcError { code, message: message.to_string() }),
    };
    let mut out = io::stdout().lock();
    serde_json::to_writer(&mut out, &response).ok();
    writeln!(out).ok();
    out.flush().ok();
}
```

### Building

```bash
cargo build --release --target wasm32-wasip1
```

The WASM binary will be at `target/wasm32-wasip1/release/my_mcp_server.wasm`.

### WASM Manifest

```json
{
  "$schema": "https://harbor.dev/schemas/mcp-wasm-manifest.v1.json",
  "manifestVersion": "1.0.0",
  "name": "my-wasm-server",
  "version": "1.0.0",
  "description": "A WASM MCP server",
  
  "wasm": {
    "file": "target/wasm32-wasip1/release/my_mcp_server.wasm",
    "wasi": {
      "version": "preview1"
    }
  },
  
  "tools": [
    {
      "name": "greet",
      "description": "Say hello",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": { "type": "string" }
        },
        "required": ["name"]
      }
    }
  ]
}
```

---

## Manifest Reference

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `manifestVersion` | `"1.0.0"` | Always `"1.0.0"` |
| `name` | string | Machine-readable ID (lowercase, hyphens) |
| `version` | string | Semver version |

### Runtime-Specific Fields

**JavaScript:**
| Field | Description |
|-------|-------------|
| `runtime` | Must be `"js"` |
| `scriptUrl` | URL/path to JS file |
| `scriptBase64` | Or base64-encoded JS |

**WASM:**
| Field | Description |
|-------|-------------|
| `wasm.file` | Path to .wasm file |
| `wasm.wasi.version` | `"preview1"` or `"preview2"` |
| `wasm.memory.initial` | Initial memory (64KB pages) |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `displayName` | string | Human-readable name |
| `description` | string | Brief description |
| `author` | string/object | Author info |
| `license` | string | SPDX license |
| `homepage` | string | Project URL |
| `repository` | string | Source repo URL |
| `keywords` | string[] | Discovery keywords |
| `capabilities` | object | Required capabilities |
| `environment` | array | Non-secret env vars |
| `secrets` | array | API keys, tokens |
| `tools` | array | Tool declarations |

---

## MCP Protocol Basics

MCP uses JSON-RPC 2.0 over stdio. Your server must handle these methods:

### `tools/list`

Returns available tools.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "tool_name",
        "description": "What this tool does",
        "inputSchema": {
          "type": "object",
          "properties": { ... },
          "required": [...]
        }
      }
    ]
  }
}
```

### `tools/call`

Executes a tool.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "tool_name",
    "arguments": { "arg1": "value1" }
  }
}
```

**Response (success):**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      { "type": "text", "text": "Tool output here" }
    ]
  }
}
```

**Response (error):**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "error": {
    "code": -32000,
    "message": "Something went wrong"
  }
}
```

### Error Codes

| Code | Meaning |
|------|---------|
| -32700 | Parse error |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |
| -32000 to -32099 | Server-defined errors |

---

## Adding Capabilities

### Network Access

```json
{
  "capabilities": {
    "network": {
      "required": true,
      "hosts": ["api.github.com", "*.googleapis.com"],
      "description": "Fetches data from GitHub and Google APIs"
    }
  }
}
```

**Host patterns:**
- `api.example.com` - exact match
- `*.example.com` - wildcard subdomain
- `*` - any host (requires explicit approval)

### Secrets

```json
{
  "secrets": [
    {
      "name": "GITHUB_TOKEN",
      "description": "GitHub personal access token",
      "required": true,
      "helpUrl": "https://github.com/settings/tokens"
    }
  ]
}
```

Access in code:
```javascript
const token = process.env.GITHUB_TOKEN;
```

### Environment Variables

```json
{
  "environment": [
    {
      "name": "MAX_RESULTS",
      "description": "Maximum results to return",
      "type": "number",
      "default": 10
    }
  ]
}
```

---

## OAuth Integration

For APIs requiring OAuth (Google, GitHub, etc.), Harbor can handle the OAuth flow.

### Manifest Configuration

```json
{
  "oauth": {
    "provider": "google",
    "scopes": [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send"
    ],
    "tokenEnvVar": "GMAIL_ACCESS_TOKEN"
  },
  "secrets": [
    {
      "name": "GMAIL_ACCESS_TOKEN",
      "description": "Gmail OAuth token (managed by Harbor)",
      "required": true
    }
  ]
}
```

### Using the Token

```javascript
const token = process.env.GMAIL_ACCESS_TOKEN;

const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

Harbor handles:
- OAuth authorization flow
- Token storage
- Token refresh

---

## Testing Your Server

### Local Testing with stdio

Test your server by piping JSON-RPC messages:

```bash
# List tools
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node server.js

# Call a tool
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"greet","arguments":{"name":"World"}}}' | node server.js
```

### Testing with Harbor

1. Load your manifest in Harbor's "Add Server" dialog
2. Point to your local files
3. Use the Harbor sidebar to test tool calls

### Debugging

**JavaScript:**
- All `console.log` output appears in browser DevTools with `[JS MCP]` prefix
- Check for network errors in the Network tab

**WASM:**
- Use `eprintln!` for debug output (goes to stderr)
- Check WASI compatibility issues

---

## Publishing

### Checklist

- [ ] Manifest has all required fields
- [ ] Tools are documented with descriptions
- [ ] Secrets have `helpUrl` for obtaining credentials
- [ ] Capabilities are minimized (only request what you need)
- [ ] README explains installation and usage
- [ ] License is specified

### Distribution Options

1. **URL-based**: Host manifest and server files on a web server
2. **Embedded**: Embed server code as base64 in manifest
3. **Package**: Create a .mcpw archive (zip containing manifest + WASM)

### Manifest with Embedded Code

```json
{
  "manifestVersion": "1.0.0",
  "name": "my-server",
  "version": "1.0.0",
  "runtime": "js",
  "scriptBase64": "YXN5bmMgZnVuY3Rpb24gbWFpbi..."
}
```

Generate base64:
```bash
base64 -i server.js | tr -d '\n'
```

---

## Examples

For complete working examples, see:

- **[builtin/echo-js](./builtin/echo-js/)** - Simple JavaScript server
- **[builtin/time-wasm](./builtin/time-wasm/)** - Simple WASM server
- **[examples/gmail](./examples/gmail/)** - Real-world API integration with OAuth

---

## Resources

- [MCP Specification](https://modelcontextprotocol.io/)
- [JS Server Spec](../docs/JS_MCP_SERVER_SPEC.md)
- [WASM Manifest Spec](../docs/MCP_WASM_MANIFEST_SPEC.md)
- [JSON-RPC 2.0](https://www.jsonrpc.org/specification)
