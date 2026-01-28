//! Time MCP Server (WASM)
//!
//! A simple MCP server that returns the current time.
//! Since WASM cannot access system clocks, the host injects
//! the current time via the tool arguments.

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};
use std::time::{SystemTime, UNIX_EPOCH};

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

fn write_response(response: RpcResponse) {
    let mut out = io::stdout().lock();
    let line = serde_json::to_string(&response).unwrap_or_else(|_| "{}".to_string());
    let _ = out.write_all(line.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

fn main() {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        if let Ok(raw) = line {
            if raw.trim().is_empty() {
                continue;
            }
            let request: Result<RpcRequest, _> = serde_json::from_str(&raw);
            match request {
                Ok(req) => handle_request(req),
                Err(_) => {
                    write_response(RpcResponse {
                        jsonrpc: "2.0",
                        id: serde_json::Value::Null,
                        result: None,
                        error: Some(RpcError {
                            code: -32700,
                            message: "Parse error".to_string(),
                        }),
                    });
                }
            }
        }
    }
}

fn handle_request(request: RpcRequest) {
    match request.method.as_str() {
        "initialize" => {
            let result = serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "mcp-time", "version": "1.0.0" }
            });
            write_response(RpcResponse {
                jsonrpc: "2.0",
                id: request.id,
                result: Some(result),
                error: None,
            });
        }
        "tools/list" => {
            let result = serde_json::json!({
                "tools": [
                    {
                        "name": "time.now",
                        "description": "Get the current date and time in ISO 8601 format (UTC)",
                        "inputSchema": {
                            "type": "object",
                            "properties": {},
                            "required": []
                        }
                    }
                ]
            });
            write_response(RpcResponse {
                jsonrpc: "2.0",
                id: request.id,
                result: Some(result),
                error: None,
            });
        }
        "tools/call" => {
            // In WASM, we can't access system time directly.
            // The host injects the current time via the "now" argument.
            let now = request
                .params
                .get("arguments")
                .and_then(|args| args.get("now"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| {
                    // Fallback: try SystemTime (works in native, not in WASM)
                    format_system_time()
                });

            let result = serde_json::json!({
                "content": [
                    {
                        "type": "text",
                        "text": now
                    }
                ]
            });
            write_response(RpcResponse {
                jsonrpc: "2.0",
                id: request.id,
                result: Some(result),
                error: None,
            });
        }
        _ => {
            write_response(RpcResponse {
                jsonrpc: "2.0",
                id: request.id,
                result: None,
                error: Some(RpcError {
                    code: -32601,
                    message: "Method not found".to_string(),
                }),
            });
        }
    }
}

/// Format the current system time as ISO 8601.
/// This works in native Rust but not in WASM (where SystemTime is unavailable).
fn format_system_time() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| {
            let secs = d.as_secs();
            let millis = d.subsec_millis();
            let days = secs / 86400;
            let remaining = secs % 86400;
            let hours = remaining / 3600;
            let minutes = (remaining % 3600) / 60;
            let seconds = remaining % 60;

            let mut year = 1970i32;
            let mut remaining_days = days as i32;

            loop {
                let days_in_year =
                    if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) {
                        366
                    } else {
                        365
                    };
                if remaining_days < days_in_year {
                    break;
                }
                remaining_days -= days_in_year;
                year += 1;
            }

            let is_leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
            let days_in_months = if is_leap {
                [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
            } else {
                [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
            };

            let mut month = 1;
            for &days_in_month in &days_in_months {
                if remaining_days < days_in_month {
                    break;
                }
                remaining_days -= days_in_month;
                month += 1;
            }
            let day = remaining_days + 1;

            format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
                year, month, day, hours, minutes, seconds, millis
            )
        })
        .unwrap_or_else(|_| {
            "Time unavailable - host did not provide 'now' argument".to_string()
        })
}
