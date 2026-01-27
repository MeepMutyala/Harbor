# MCP Servers

Standalone MCP server implementations for testing and demonstration.

## Included Servers

### gmail-mcp-server

Gmail MCP server for email interaction. Used by the Email Chat demo.

- **Type**: npm package
- **Transport**: stdio
- **Tools**: Search emails, read messages, manage labels

### mcp-time-wasm

Simple time server compiled to WebAssembly. Demonstrates WASM MCP servers.

- **Type**: WASM module
- **Transport**: In-browser
- **Tools**: Get current time, format dates

## Usage

These servers can be used with any MCP-compatible host, not just the demo applications.
