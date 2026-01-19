//! Native Messaging protocol handler for browser extension communication.
//!
//! The native messaging protocol uses stdin/stdout with length-prefixed JSON messages.
//! Message format: 4-byte little-endian length prefix, followed by JSON payload.

use std::io::{self, Read, Write};
use tokio::sync::mpsc;

/// Message from the browser extension
#[derive(Debug, serde::Deserialize)]
struct IncomingMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[allow(dead_code)]
    payload: Option<serde_json::Value>,
}

/// Message to the browser extension
#[derive(Debug, serde::Serialize)]
struct OutgoingMessage {
    #[serde(rename = "type")]
    msg_type: String,
    payload: serde_json::Value,
}

/// Read a native messaging message from stdin
fn read_message() -> io::Result<Option<IncomingMessage>> {
    let mut stdin = io::stdin().lock();
    
    // Read 4-byte length prefix (little-endian)
    let mut len_bytes = [0u8; 4];
    match stdin.read_exact(&mut len_bytes) {
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    
    let len = u32::from_le_bytes(len_bytes) as usize;
    
    // Sanity check on message length (max 1MB)
    if len > 1024 * 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Message too large",
        ));
    }
    
    // Read the JSON payload
    let mut buffer = vec![0u8; len];
    stdin.read_exact(&mut buffer)?;
    
    // Parse JSON
    let message: IncomingMessage = serde_json::from_slice(&buffer)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    
    Ok(Some(message))
}

/// Write a native messaging message to stdout
fn write_message(message: &OutgoingMessage) -> io::Result<()> {
    let json = serde_json::to_vec(message)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    
    let len = json.len() as u32;
    let len_bytes = len.to_le_bytes();
    
    let mut stdout = io::stdout().lock();
    stdout.write_all(&len_bytes)?;
    stdout.write_all(&json)?;
    stdout.flush()?;
    
    Ok(())
}

/// Send a status message to the extension
fn send_status(status: &str, message: &str) {
    let msg = OutgoingMessage {
        msg_type: "status".to_string(),
        payload: serde_json::json!({
            "status": status,
            "message": message,
            "port": 9137,
        }),
    };
    
    if let Err(e) = write_message(&msg) {
        tracing::error!("Failed to write native message: {}", e);
    }
}

/// Run the native messaging event loop.
/// This keeps the process alive while the extension is connected.
pub async fn run_native_messaging() {
    tracing::info!("Starting native messaging handler");
    
    // Send initial ready message
    send_status("ready", "Harbor bridge is running");
    
    // Create a channel for shutdown signaling
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
    
    // Spawn a blocking task to read from stdin
    let read_handle = tokio::task::spawn_blocking(move || {
        loop {
            match read_message() {
                Ok(Some(msg)) => {
                    tracing::debug!("Received native message: {:?}", msg);
                    
                    match msg.msg_type.as_str() {
                        "ping" => {
                            send_status("pong", "Bridge is alive");
                        }
                        "shutdown" => {
                            tracing::info!("Received shutdown request");
                            let _ = shutdown_tx.blocking_send(());
                            break;
                        }
                        "status" => {
                            send_status("ready", "Harbor bridge is running");
                        }
                        _ => {
                            tracing::debug!("Unknown message type: {}", msg.msg_type);
                        }
                    }
                }
                Ok(None) => {
                    // EOF - extension disconnected
                    tracing::info!("Native messaging connection closed (EOF)");
                    break;
                }
                Err(e) => {
                    tracing::error!("Error reading native message: {}", e);
                    break;
                }
            }
        }
    });
    
    // Wait for either the read task to complete or a shutdown signal
    tokio::select! {
        _ = read_handle => {
            tracing::info!("Native messaging reader finished");
        }
        _ = shutdown_rx.recv() => {
            tracing::info!("Shutdown signal received");
        }
    }
    
    tracing::info!("Native messaging handler exiting");
}
