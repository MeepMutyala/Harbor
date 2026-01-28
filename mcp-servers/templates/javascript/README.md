# JavaScript MCP Server Template

A starter template for building JavaScript MCP servers for Harbor.

## Quick Start

1. Copy this directory to create your server:
   ```bash
   cp -r mcp-servers/templates/javascript my-server
   cd my-server
   ```

2. Edit `manifest.json`:
   - Change `id`, `name`, `description`
   - Add required capabilities
   - Define your tools

3. Edit `server.js`:
   - Implement your tool handlers
   - Add business logic

4. Test with Harbor:
   - Load the manifest in Harbor
   - Call your tools from the sidebar

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Server configuration and tool definitions |
| `server.js` | Server implementation |
| `README.md` | Documentation |

## Template Structure

The template includes:

- **`greet` tool**: Simple example that takes a name and returns a greeting
- **`add` tool**: Example with multiple parameters (adds two numbers)
- Proper error handling
- MCP protocol boilerplate

## Customization Checklist

- [ ] Update `manifest.json` with your server info
- [ ] Add required network hosts to capabilities
- [ ] Define secrets if needed (API keys, etc.)
- [ ] Implement your tools in `server.js`
- [ ] Update tool definitions in both manifest and server
- [ ] Write README for your server

## Adding Network Access

If your server needs to call external APIs:

```json
{
  "capabilities": {
    "network": {
      "required": true,
      "hosts": ["api.example.com"]
    }
  }
}
```

Then use `fetch()` in your code:

```javascript
const response = await fetch('https://api.example.com/data');
const data = await response.json();
```

## Adding Secrets

For API keys or tokens:

```json
{
  "secrets": [
    {
      "name": "API_KEY",
      "description": "Your API key",
      "required": true,
      "helpUrl": "https://example.com/get-api-key"
    }
  ]
}
```

Access in code:

```javascript
const apiKey = process.env.API_KEY;
```

## Bundling Dependencies

If you use npm packages, bundle them:

```bash
npm install
npx esbuild src/server.js --bundle --format=iife --outfile=dist/server.js
```

Then update manifest to point to `dist/server.js`.

## Resources

- [Authoring Guide](../../AUTHORING_GUIDE.md)
- [JS Server Spec](../../../docs/JS_MCP_SERVER_SPEC.md)
- [Example: Echo Server](../../builtin/echo-js/)
- [Example: Gmail Server](../../examples/gmail/)
