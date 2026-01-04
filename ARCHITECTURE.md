# Harbor Architecture

This document describes the architecture of Harbor, a Firefox extension that brings AI and MCP (Model Context Protocol) capabilities to web applications.

> **Related Documentation:**
> - [User Guide](docs/USER_GUIDE.md) — Installation and usage
> - [Developer Guide](docs/DEVELOPER_GUIDE.md) — API reference
> - [Contributing](CONTRIBUTING.md) — Development setup
> - [MCP Host](docs/MCP_HOST.md) — Execution environment details

---

## Overview

Harbor provides:

| Capability | Description |
|------------|-------------|
| **JS AI Provider** | `window.ai` and `window.agent` APIs for web pages |
| **MCP Server Management** | Install, run, and connect to MCP servers |
| **LLM Integration** | Local model support (Ollama, llamafile) |
| **Permission System** | Per-origin capability grants with user consent |
| **Chat Orchestration** | Agent loop with tool calling |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              WEB PAGE                                        │
│                                                                              │
│  window.ai                           window.agent                            │
│  ├── createTextSession()             ├── requestPermissions()                │
│  └── session.prompt()                ├── tools.list() / tools.call()        │
│                                      ├── browser.activeTab.readability()    │
│                                      └── run({ task })                       │
└───────────────────────────────────────┬─────────────────────────────────────┘
                                        │ postMessage
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FIREFOX EXTENSION                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────┐   │
│  │  Content Script   │  │   Background      │  │      Sidebar          │   │
│  │  (provider.ts)    │  │   (background.ts) │  │      (sidebar.ts)     │   │
│  │                   │  │                   │  │                       │   │
│  │  • Inject APIs    │  │  • Native msgs    │  │  • Server management  │   │
│  │  • Route messages │  │  • Permissions    │  │  • Chat UI            │   │
│  │  • Permission UI  │  │  • Orchestration  │  │  • Settings           │   │
│  └─────────┬─────────┘  └─────────┬─────────┘  └───────────┬───────────┘   │
│            │                      │                        │                │
│            └──────────────────────┼────────────────────────┘                │
│                                   │                                          │
└───────────────────────────────────┼──────────────────────────────────────────┘
                                    │ Native Messaging (stdin/stdout JSON)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            NODE.JS BRIDGE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                           MCP HOST                                     │  │
│  │  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────────┐   │  │
│  │  │ Permissions │  │  Tool Registry  │  │      Rate Limiter       │   │  │
│  │  │             │  │                 │  │                         │   │  │
│  │  │ Per-origin  │  │ Namespaced      │  │ • Max 5 calls/run       │   │  │
│  │  │ capability  │  │ serverId/tool   │  │ • 2 concurrent/origin   │   │  │
│  │  │ grants      │  │ registration    │  │ • 30s timeout           │   │  │
│  │  └─────────────┘  └─────────────────┘  └─────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐      │
│  │    Installer    │  │   LLM Manager   │  │   Chat Orchestrator     │      │
│  │                 │  │                 │  │                         │      │
│  │  • npx/uvx      │  │  • Ollama       │  │  • Agent loop           │      │
│  │  • Docker       │  │  • llamafile    │  │  • Tool routing         │      │
│  │  • Secrets      │  │  • Model select │  │  • Session management   │      │
│  └────────┬────────┘  └────────┬────────┘  └────────────┬────────────┘      │
│           │                    │                        │                    │
└───────────┼────────────────────┼────────────────────────┼────────────────────┘
            │ stdio (JSON-RPC)   │ HTTP (OpenAI)          │
            ▼                    ▼                        │
┌─────────────────────┐ ┌─────────────────────┐          │
│    MCP Servers      │ │    LLM Provider     │◄─────────┘
│  (local / Docker)   │ │  (Ollama, etc.)     │
│                     │ │                     │
│  • filesystem       │ │  • chat/completions │
│  • memory           │ │  • tool calling     │
│  • github           │ │  • streaming        │
└─────────────────────┘ └─────────────────────┘
```

---

## Data Flow

### 1. Web Page to AI Response

```
Web Page                    Extension                    Bridge                    LLM
   │                           │                           │                        │
   │ session.prompt("Hi")      │                           │                        │
   ├──────────────────────────►│                           │                        │
   │                           │ llm_chat                  │                        │
   │                           ├──────────────────────────►│                        │
   │                           │                           │ POST /v1/chat/...      │
   │                           │                           ├───────────────────────►│
   │                           │                           │◄───────────────────────┤
   │                           │◄──────────────────────────┤                        │
   │◄──────────────────────────┤                           │                        │
   │ "Hello! How can I help?"  │                           │                        │
```

### 2. Tool Call Flow

```
Web Page                    Extension                    Bridge                 MCP Server
   │                           │                           │                        │
   │ agent.tools.call(...)     │                           │                        │
   ├──────────────────────────►│                           │                        │
   │                           │ ① Check permission        │                        │
   │                           │ ② host_call_tool          │                        │
   │                           ├──────────────────────────►│                        │
   │                           │                           │ ③ Check rate limit     │
   │                           │                           │ ④ Resolve tool         │
   │                           │                           │ ⑤ MCP call             │
   │                           │                           ├───────────────────────►│
   │                           │                           │◄───────────────────────┤
   │                           │◄──────────────────────────┤                        │
   │◄──────────────────────────┤                           │                        │
   │ { result: ... }           │                           │                        │
```

### 3. Agent Run (Autonomous Task)

```
User: "Find my recent GitHub PRs and summarize them"
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Chat Orchestrator                           │
│                                                                  │
│  1. Tool Router analyzes task → selects "github" server         │
│  2. Collect tools from github server only                       │
│  3. Send to LLM with tool definitions                           │
│  4. LLM returns: call github/list_prs                           │
│  5. Execute tool → get results                                  │
│  6. Send results back to LLM                                    │
│  7. LLM returns: call github/get_pr_details                     │
│  8. Execute tool → get results                                  │
│  9. Send results back to LLM                                    │
│  10. LLM generates final summary                                │
└─────────────────────────────────────────────────────────────────┘
              │
              ▼
"You have 3 open PRs: #123 fixes auth bug, #124 adds dark mode..."
```

---

## Components

### Extension Layer

| File | Purpose |
|------|---------|
| `background.ts` | Native messaging, permission management, message routing |
| `sidebar.ts` | Main UI for server management, chat, settings |
| `provider/*.ts` | JS AI Provider injection (`window.ai`, `window.agent`) |
| `vscode-detector.ts` | Detects "Install in VS Code" buttons |

### Bridge Layer

| Directory | Purpose |
|-----------|---------|
| `host/` | MCP execution environment (permissions, rate limiting, tool registry) |
| `mcp/` | MCP protocol implementation (stdio client, connection management) |
| `llm/` | LLM provider abstraction (Ollama, llamafile) |
| `chat/` | Chat orchestration (agent loop, session management, tool routing) |
| `installer/` | Server installation (npm, pypi, docker, secrets) |
| `catalog/` | Server directory (official registry, GitHub awesome list) |
| `auth/` | OAuth and credential management |

---

## Permission System

Permissions are scoped per-origin with capability-based grants.

### Scopes

| Scope | Description | Grants Access To |
|-------|-------------|------------------|
| `model:prompt` | Basic text generation | `ai.createTextSession()` |
| `model:tools` | AI with tool calling | `agent.run()` |
| `mcp:tools.list` | List available tools | `agent.tools.list()` |
| `mcp:tools.call` | Execute tools | `agent.tools.call()` |
| `browser:activeTab.read` | Read active tab | `agent.browser.activeTab.readability()` |

### Grant Types

| Type | Behavior | Storage |
|------|----------|---------|
| `ALLOW_ONCE` | Expires after 10 min or tab close | Memory |
| `ALLOW_ALWAYS` | Persists across sessions | `browser.storage.local` |
| `DENY` | Explicitly denied (no re-prompt) | `browser.storage.local` |

### Enforcement Flow

```
Request arrives with origin "https://example.com"
        │
        ▼
┌───────────────────────────┐
│ Check DENY grants         │─────► Denied? Return ERR_PERMISSION_DENIED
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│ Check ALLOW_ALWAYS grants │─────► Found? Proceed
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│ Check ALLOW_ONCE grants   │─────► Found & not expired? Proceed
│ (check expiry & tab)      │─────► Expired? Remove & continue
└───────────────────────────┘
        │
        ▼
Return ERR_SCOPE_REQUIRED
```

---

## Tool Registry

Tools from MCP servers are namespaced to prevent collisions.

**Format:** `{serverId}/{toolName}`

**Examples:**
- `filesystem/read_file`
- `github/search_issues`
- `memory-server/save_memory`

### Registration

```
MCP Server connects
        │
        ▼
┌───────────────────────────┐
│ Call tools/list           │
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│ Register tools with       │
│ namespace prefix          │
│                           │
│ read_file → filesystem/   │
│             read_file     │
└───────────────────────────┘
        │
        ▼
Tools available for invocation
```

---

## Rate Limiting

| Limit | Default | Purpose |
|-------|---------|---------|
| `maxCallsPerRun` | 5 | Prevent runaway agent loops |
| `maxConcurrentPerOrigin` | 2 | Fair resource sharing |
| `defaultTimeoutMs` | 30,000 | Prevent hanging calls |

### Budget Tracking

```typescript
// Create a run with budget
const run = rateLimiter.createRun(origin, 5);

// Each tool call decrements budget
await rateLimiter.acquireCallSlot(origin, run.runId);
// → Budget: 5 → 4

// Exceeding budget returns error
await rateLimiter.acquireCallSlot(origin, run.runId);
// → ERR_BUDGET_EXCEEDED
```

---

## Server Lifecycle

```
         ┌──────────────────┐
         │    INSTALLING    │ Package download/build
         └────────┬─────────┘
                  │
                  ▼
         ┌──────────────────┐
         │     STOPPED      │ Installed but not running
         └────────┬─────────┘
                  │ start
                  ▼
         ┌──────────────────┐
         │    STARTING      │ Process spawning
         └────────┬─────────┘
                  │
                  ▼
         ┌──────────────────┐
    ┌───►│     RUNNING      │ Connected and operational
    │    └────────┬─────────┘
    │             │ crash
    │             ▼
    │    ┌──────────────────┐
    │    │     CRASHED      │ Unexpected exit
    │    └────────┬─────────┘
    │             │ auto-restart (up to 3 times)
    └─────────────┘
```

---

## Data Storage

All persistent data is stored in `~/.harbor/`:

| File | Format | Contents |
|------|--------|----------|
| `harbor.db` | SQLite | Server configurations |
| `catalog.db` | SQLite | Cached server catalog |
| `installed_servers.json` | JSON | Installed server metadata |
| `secrets/credentials.json` | JSON | API keys (file permissions: 600) |
| `sessions/*.json` | JSON | Chat session history |

---

## Error Codes

| Code | Description |
|------|-------------|
| `ERR_PERMISSION_DENIED` | Caller lacks required permission |
| `ERR_SCOPE_REQUIRED` | Permission scope not granted |
| `ERR_SERVER_UNAVAILABLE` | MCP server not connected |
| `ERR_TOOL_NOT_FOUND` | Tool does not exist |
| `ERR_TOOL_NOT_ALLOWED` | Tool not in allowlist |
| `ERR_TOOL_TIMEOUT` | Tool call timed out |
| `ERR_TOOL_FAILED` | Tool execution error |
| `ERR_RATE_LIMITED` | Concurrent limit exceeded |
| `ERR_BUDGET_EXCEEDED` | Run budget exhausted |

---

## Security Model

| Layer | Protection |
|-------|------------|
| **Origin Isolation** | Permissions scoped to origin |
| **User Consent** | Explicit grants required |
| **No Payload Logging** | Tool args/results not logged |
| **Rate Limiting** | Prevents abuse |
| **Tool Allowlisting** | Origins can be restricted to specific tools |
| **Tab-Scoped Grants** | ALLOW_ONCE can be tied to a tab |
| **Secret Storage** | Credentials stored with restricted file permissions |

---

## Message Protocol

The bridge uses native messaging with length-prefixed JSON frames.

### Frame Format

```
┌─────────────────┬────────────────────────────────────────┐
│ Length (4 bytes)│ JSON Payload (UTF-8)                   │
│ Little-endian   │ { "type": "...", "request_id": "..." } │
└─────────────────┴────────────────────────────────────────┘
```

### Message Categories

**Server Management:** `add_server`, `remove_server`, `list_servers`, `connect_server`, `disconnect_server`

**MCP Operations:** `mcp_connect`, `mcp_list_tools`, `mcp_call_tool`, `mcp_read_resource`

**LLM:** `llm_detect`, `llm_chat`, `llm_set_active`

**Chat:** `chat_create_session`, `chat_send_message`, `chat_list_sessions`

**Host:** `host_list_tools`, `host_call_tool`, `host_grant_permission`

See [Developer Guide](docs/DEVELOPER_GUIDE.md) for complete message reference.
