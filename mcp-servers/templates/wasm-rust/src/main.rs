//! My MCP Server - WASM Template
//!
//! This is a starter template for building WASM MCP servers in Rust.
//! Customize the tools and handlers below for your use case.
//!
//! Build with:
//!   cargo build --release --target wasm32-wasip1

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};

// ============================================================================
// JSON-RPC Types
// ============================================================================

#[derive(Debug, Deserialize)]
struct RpcRequest {
    id: serde_json::Value,
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct RpcResponse {
    jsonrpc: &'static str,
    id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
struct RpcError {
    code: i64,
    message: String,
}

// ============================================================================
// Tool Definitions
// ============================================================================

fn get_tools() -> serde_json::Value {
    serde_json::json!({
        "tools": [
            {
                "name": "greet",
                "description": "Say hello to someone",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Name of the person to greet"
                        }
                    },
                    "required": ["name"]
                }
            },
            {
                "name": "add",
                "description": "Add two numbers together",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "a": { "type": "number", "description": "First number" },
                        "b": { "type": "number", "description": "Second number" }
                    },
                    "required": ["a", "b"]
                }
            }
        ]
    })
}

// ============================================================================
// Tool Handlers
// ============================================================================

fn handle_greet(params: &serde_json::Value) -> String {
    let name = params
        .get("arguments")
        .and_then(|a| a.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("World");
    
    format!("Hello, {}!", name)
}

fn handle_add(params: &serde_json::Value) -> String {
    let args = params.get("arguments");
    
    let a = args
        .and_then(|a| a.get("a"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    
    let b = args
        .and_then(|a| a.get("b"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    
    let result = a + b;
    format!("{} + {} = {}", a, b, result)
}

// ============================================================================
// Response Writers
// ============================================================================

fn write_response(response: &RpcResponse) {
    let mut out = io::stdout().lock();
    if let Ok(json) = serde_json::to_string(response) {
        let _ = out.write_all(json.as_bytes());
        let _ = out.write_all(b"\n");
        let _ = out.flush();
    }
}

fn write_result(id: serde_json::Value, result: serde_json::Value) {
    write_response(&RpcResponse {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    });
}

fn write_tool_result(id: serde_json::Value, text: &str) {
    let result = serde_json::json!({
        "content": [{ "type": "text", "text": text }]
    });
    write_result(id, result);
}

fn write_error(id: serde_json::Value, code: i64, message: &str) {
    write_response(&RpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(RpcError {
            code,
            message: message.to_string(),
        }),
    });
}

// ============================================================================
// Request Handling
// ============================================================================

fn handle_request(request: RpcRequest) {
    match request.method.as_str() {
        // Initialize (required by MCP)
        "initialize" => {
            let result = serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "my-wasm-server", "version": "1.0.0" }
            });
            write_result(request.id, result);
        }

        // List available tools
        "tools/list" => {
            write_result(request.id, get_tools());
        }

        // Execute a tool
        "tools/call" => {
            let tool_name = request.params
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("");
            
            match tool_name {
                "greet" => {
                    let result = handle_greet(&request.params);
                    write_tool_result(request.id, &result);
                }
                "add" => {
                    let result = handle_add(&request.params);
                    write_tool_result(request.id, &result);
                }
                _ => {
                    write_error(
                        request.id,
                        -32601,
                        &format!("Unknown tool: {}", tool_name),
                    );
                }
            }
        }

        // Unknown method
        _ => {
            write_error(
                request.id,
                -32601,
                &format!("Method not found: {}", request.method),
            );
        }
    }
}

// ============================================================================
// Main Loop
// ============================================================================

fn main() {
    let stdin = io::stdin();
    
    for line in stdin.lock().lines() {
        let Ok(raw) = line else { continue };
        if raw.trim().is_empty() {
            continue;
        }
        
        match serde_json::from_str::<RpcRequest>(&raw) {
            Ok(request) => handle_request(request),
            Err(_) => {
                write_error(serde_json::Value::Null, -32700, "Parse error");
            }
        }
    }
}
