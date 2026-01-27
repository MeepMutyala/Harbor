# MCP Time WASM Example

Minimal MCP WASM server that returns the time provided by the host.

## Build
```
rustup target add wasm32-wasip1
cargo build --release --target wasm32-wasip1
```

The output is:
```
target/wasm32-wasip1/release/mcp-time-wasm.wasm
```

Copy it into the extension:
```
cp target/wasm32-wasip1/release/mcp-time-wasm.wasm ../../extension/assets/mcp-time.wasm
```
