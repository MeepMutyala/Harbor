//! OAuth callback HTTP server.
//!
//! Runs a lightweight HTTP server on localhost to receive OAuth callbacks.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{Query, State},
    response::{Html, IntoResponse},
    routing::get,
    Router,
};
use tokio::sync::{mpsc, oneshot, RwLock};

use super::{
    exchange_code, get_credentials, get_token_store_mut, take_pending_flow, OAuthTokens,
    StoredTokens,
};

const OAUTH_PORT: u16 = 8765;
const CALLBACK_PATH: &str = "/oauth/callback";

/// OAuth callback server state.
#[allow(dead_code)]
pub struct OAuthCallbackServer {
    /// Channel to signal server shutdown
    shutdown_tx: Option<oneshot::Sender<()>>,
}

#[allow(dead_code)]
impl OAuthCallbackServer {
    pub fn new() -> Self {
        Self { shutdown_tx: None }
    }
}

/// Shared state for the callback server.
struct ServerState {
    /// Channel to send completed tokens back
    token_sender: mpsc::Sender<TokenResult>,
}

/// Result of a token exchange.
struct TokenResult {
    server_id: String,
    tokens: Result<OAuthTokens, String>,
    provider: String,
    scopes: Vec<String>,
}

// Global server state
lazy_static::lazy_static! {
    static ref SERVER_RUNNING: Arc<RwLock<bool>> = Arc::new(RwLock::new(false));
    static ref TOKEN_CHANNEL: Arc<RwLock<Option<mpsc::Sender<TokenResult>>>> = 
        Arc::new(RwLock::new(None));
}

/// Ensure the OAuth callback server is running.
pub async fn ensure_server_running() -> Result<(), String> {
    let mut running = SERVER_RUNNING.write().await;
    if *running {
        return Ok(());
    }
    
    // Create channel for token results
    let (tx, mut rx) = mpsc::channel::<TokenResult>(10);
    *TOKEN_CHANNEL.write().await = Some(tx.clone());
    
    // Start the server
    let state = Arc::new(ServerState { token_sender: tx });
    
    let app = Router::new()
        .route(CALLBACK_PATH, get(handle_callback))
        .route("/", get(handle_root))
        .with_state(state);
    
    let addr = SocketAddr::from(([127, 0, 0, 1], OAUTH_PORT));
    
    // Try to bind
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AddrInUse {
                format!("Port {} is already in use. Another OAuth flow may be in progress.", OAUTH_PORT)
            } else {
                format!("Failed to bind to port {}: {}", OAUTH_PORT, e)
            }
        })?;
    
    tracing::info!("OAuth callback server listening on http://127.0.0.1:{}", OAUTH_PORT);
    *running = true;
    
    // Spawn server task
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!("OAuth server error: {}", e);
        }
    });
    
    // Spawn token handler task
    tokio::spawn(async move {
        while let Some(result) = rx.recv().await {
            handle_token_result(result).await;
        }
    });
    
    Ok(())
}

/// Handle token result - store tokens.
async fn handle_token_result(result: TokenResult) {
    match result.tokens {
        Ok(tokens) => {
            let mut store = get_token_store_mut().await;
            if let Some(ref mut s) = *store {
                let stored = StoredTokens {
                    server_id: result.server_id.clone(),
                    provider: result.provider,
                    tokens,
                    scopes: result.scopes,
                    created_at: chrono::Utc::now().timestamp_millis(),
                    updated_at: chrono::Utc::now().timestamp_millis(),
                };
                s.set_tokens(&result.server_id, stored);
                if let Err(e) = s.save() {
                    tracing::error!("Failed to save tokens: {}", e);
                }
            }
            tracing::info!("OAuth tokens stored for server: {}", result.server_id);
        }
        Err(e) => {
            tracing::error!("OAuth token exchange failed: {}", e);
        }
    }
}

/// Handle root path - just show a simple page.
async fn handle_root() -> impl IntoResponse {
    Html(
        r#"<!DOCTYPE html>
<html>
<head>
    <title>Harbor OAuth</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
        }
        .container {
            text-align: center;
            padding: 40px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 16px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Harbor OAuth Server</h1>
        <p>This server handles OAuth callbacks for Harbor.</p>
    </div>
</body>
</html>"#,
    )
}

/// Handle OAuth callback.
async fn handle_callback(
    State(state): State<Arc<ServerState>>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let code = params.get("code");
    let callback_state = params.get("state");
    let error = params.get("error");
    let error_description = params.get("error_description");
    
    // Handle error from provider
    if let Some(err) = error {
        let msg = error_description.map(|d| d.as_str()).unwrap_or(err.as_str());
        tracing::error!("OAuth provider returned error: {}", msg);
        return Html(error_page("Authorization Failed", msg));
    }
    
    // Validate required params
    let (code, callback_state) = match (code, callback_state) {
        (Some(c), Some(s)) => (c, s),
        _ => {
            tracing::error!("OAuth callback missing code or state");
            return Html(error_page(
                "Invalid Request",
                "Missing authorization code or state parameter.",
            ));
        }
    };
    
    // Find pending flow
    let flow = match take_pending_flow(callback_state).await {
        Some(f) => f,
        None => {
            tracing::error!("Unknown OAuth state: {}", &callback_state[..8.min(callback_state.len())]);
            return Html(error_page(
                "Session Expired",
                "This authorization session has expired. Please try again.",
            ));
        }
    };
    
    tracing::info!(
        "OAuth callback received for {} (server: {})",
        flow.provider_id,
        flow.server_id
    );
    
    // Get credentials and exchange code
    let credentials = match get_credentials(&flow.provider_id).await {
        Some(c) => c,
        None => {
            return Html(error_page(
                "Configuration Error",
                "OAuth credentials not found.",
            ));
        }
    };
    
    let tokens = exchange_code(code, &flow, &credentials).await;
    
    // Send result through channel
    let _ = state.token_sender.send(TokenResult {
        server_id: flow.server_id.clone(),
        tokens: tokens.clone(),
        provider: flow.provider_id.clone(),
        scopes: flow.scopes.clone(),
    }).await;
    
    match tokens {
        Ok(_) => Html(success_page(
            "Authorization Successful",
            "You can close this window and return to Harbor.",
        )),
        Err(e) => Html(error_page("Authorization Failed", &e)),
    }
}

/// Generate success HTML page.
fn success_page(title: &str, message: &str) -> String {
    format!(
        r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{title} - Harbor</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
        }}
        .container {{
            text-align: center;
            padding: 40px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 16px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            max-width: 400px;
        }}
        .icon {{ font-size: 48px; margin-bottom: 20px; }}
        h1 {{ font-size: 24px; margin-bottom: 12px; color: #16a34a; }}
        p {{ font-size: 16px; color: rgba(255, 255, 255, 0.7); line-height: 1.5; }}
        .close-hint {{ margin-top: 20px; font-size: 14px; color: rgba(255, 255, 255, 0.4); }}
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">✅</div>
        <h1>{title}</h1>
        <p>{message}</p>
        <p class="close-hint">This window will close automatically.</p>
    </div>
    <script>
        setTimeout(() => {{ try {{ window.close(); }} catch (e) {{}} }}, 2000);
    </script>
</body>
</html>"#
    )
}

/// Generate error HTML page.
fn error_page(title: &str, message: &str) -> String {
    let escaped_message = message
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    
    format!(
        r#"<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>{title} - Harbor</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
        }}
        .container {{
            text-align: center;
            padding: 40px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 16px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            max-width: 400px;
        }}
        .icon {{ font-size: 48px; margin-bottom: 20px; }}
        h1 {{ font-size: 24px; margin-bottom: 12px; color: #dc2626; }}
        p {{ font-size: 16px; color: rgba(255, 255, 255, 0.7); line-height: 1.5; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">❌</div>
        <h1>{title}</h1>
        <p>{escaped_message}</p>
    </div>
</body>
</html>"#
    )
}
