# WASM MCP Server Template (Rust)

A starter template for building WASM MCP servers in Rust for Harbor.

## Quick Start

1. Copy this directory to create your server:
   ```bash
   cp -r mcp-servers/templates/wasm-rust my-server
   cd my-server
   ```

2. Edit `Cargo.toml`:
   - Change package name
   - Add dependencies as needed

3. Edit `manifest.json`:
   - Change `id`, `name`, `description`
   - Define your tools

4. Implement your tools in `src/main.rs`

5. Build:
   ```bash
   cargo build --release --target wasm32-wasip1
   ```

6. Test with Harbor:
   - Load the manifest in Harbor
   - Call your tools from the sidebar

## Prerequisites

- Rust toolchain: [rustup.rs](https://rustup.rs)
- WASM target:
  ```bash
  rustup target add wasm32-wasip1
  ```

## Files

| File | Purpose |
|------|---------|
| `Cargo.toml` | Rust dependencies and build config |
| `manifest.json` | Server configuration and tool definitions |
| `src/main.rs` | Server implementation |
| `README.md` | Documentation |

## Template Structure

The template includes:

- **`greet` tool**: Simple example that takes a name and returns a greeting
- **`add` tool**: Example with multiple parameters (adds two numbers)
- JSON-RPC request/response handling
- Proper error handling

## Building

```bash
# Debug build
cargo build --target wasm32-wasip1

# Release build (smaller, faster)
cargo build --release --target wasm32-wasip1
```

The WASM binary will be at:
- Debug: `target/wasm32-wasip1/debug/my_mcp_server.wasm`
- Release: `target/wasm32-wasip1/release/my_mcp_server.wasm`

## Customization Checklist

- [ ] Update `Cargo.toml` with your package info
- [ ] Update `manifest.json` with your server info
- [ ] Add required capabilities if needed
- [ ] Implement your tools in `src/main.rs`
- [ ] Update tool definitions in both manifest and code
- [ ] Build and test

## Adding Tools

1. Add the tool definition in both `manifest.json` and `src/main.rs`
2. Add a handler function
3. Add the case in `handle_tools_call()`

Example:

```rust
// In handle_tools_call()
"my_tool" => {
    let arg = params.get("arguments")
        .and_then(|a| a.get("input"))
        .and_then(|v| v.as_str())
        .unwrap_or("default");
    
    let result = format!("Processed: {}", arg);
    write_tool_result(id, &result);
}
```

## WASM Considerations

### What Works
- stdio (reading/writing)
- JSON parsing
- String manipulation
- Math operations
- Most pure Rust code

### What Doesn't Work
- System time (use host-provided time)
- Network requests (in pure WASM)
- File system access (in pure WASM)
- Threads

### Getting System Time

WASM can't access the system clock. If you need the current time, have the host pass it as a parameter or use the time server as a dependency.

## Optimizing WASM Size

The template includes optimizations in `Cargo.toml`:

```toml
[profile.release]
opt-level = "s"    # Optimize for size
lto = true         # Link-time optimization
strip = true       # Strip symbols
```

For even smaller builds, consider:
- Removing unused dependencies
- Using `#![no_std]` if possible
- Using `wasm-opt` post-processing

## Resources

- [Authoring Guide](../../AUTHORING_GUIDE.md)
- [WASM Manifest Spec](../../../docs/MCP_WASM_MANIFEST_SPEC.md)
- [Example: Time Server](../../builtin/time-wasm/)
- [Rust WASM Guide](https://rustwasm.github.io/docs/book/)
