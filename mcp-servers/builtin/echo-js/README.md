# Echo MCP Server (JavaScript)

A simple JavaScript MCP server for testing and demonstration. This server is automatically installed with Harbor.

## Tools

### `echo`

Echoes back the input message.

**Input:**
```json
{
  "message": "Hello, World!"
}
```

**Output:**
```
Echo: Hello, World!
```

### `reverse`

Reverses a string.

**Input:**
```json
{
  "text": "Harbor"
}
```

**Output:**
```
robraH
```

## Usage

This server is built-in and automatically available. No installation required.

### Testing via Harbor Sidebar

1. Open Harbor sidebar
2. Select "Echo Server" from the server list
3. Try calling the `echo` or `reverse` tools

### Example Tool Calls

```json
// Echo
{
  "name": "echo",
  "arguments": { "message": "Testing 1 2 3" }
}

// Reverse
{
  "name": "reverse",
  "arguments": { "text": "Hello" }
}
```

## Capabilities

This server requires no special capabilities:
- No network access
- No filesystem access
- No secrets

## Source Code

See [echo-server.js](./echo-server.js) for the full implementation.

This server demonstrates:
- Basic MCP request/response handling
- Multiple tool implementations
- Error handling
- The `MCP.readLine()` / `MCP.writeLine()` interface

## Manifest

The manifest is embedded in Harbor at build time. See [manifest.json](./manifest.json) for the structure.
