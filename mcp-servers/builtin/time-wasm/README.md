# Time MCP Server (WASM)

A simple WASM MCP server written in Rust that returns the current time. This server is automatically installed with Harbor.

## Tools

### `time.now`

Returns the current date and time in ISO 8601 format (UTC).

**Input:**
```json
{}
```

**Output:**
```
2024-01-15T10:30:45.123Z
```

## Usage

This server is built-in and automatically available. No installation required.

### Testing via Harbor Sidebar

1. Open Harbor sidebar
2. Select "Time Server" from the server list
3. Call the `time.now` tool

### Example Tool Call

```json
{
  "name": "time.now",
  "arguments": {}
}
```

## Technical Details

### WASM and System Time

WASM modules cannot directly access the system clock. The host (Harbor) provides the current time to the server via the tool arguments when the time is needed.

The server includes a fallback implementation that attempts to use `SystemTime` (works in native mode but not WASM), but primarily relies on the host-injected `now` parameter.

## Building from Source

### Prerequisites

- Rust toolchain
- WASM target: `rustup target add wasm32-wasip1`

### Build

```bash
cd mcp-servers/builtin/time-wasm
cargo build --release --target wasm32-wasip1
```

The WASM binary will be at `target/wasm32-wasip1/release/mcp_time_wasm.wasm`.

## Capabilities

This server requires no special capabilities:
- No network access
- No filesystem access
- No secrets

## Source Code

See [src/main.rs](./src/main.rs) for the full Rust implementation.

This server demonstrates:
- Basic WASM MCP server structure
- JSON-RPC request/response handling in Rust
- Host-provided parameters (time injection)
- WASI stdio communication

## Project Structure

```
time-wasm/
├── Cargo.toml         # Rust dependencies
├── manifest.json      # MCP manifest
├── README.md          # This file
└── src/
    └── main.rs        # Server implementation
```

## Manifest

See [manifest.json](./manifest.json) for the server configuration.
