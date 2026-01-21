//! OAuth flow handling - PKCE, authorization URLs, token exchange.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use sha2::{Digest, Sha256};
use url::Url;

use super::{
    providers::get_provider_config, OAuthCredentials, OAuthFlowState, OAuthTokens,
};

const CALLBACK_URL: &str = "http://127.0.0.1:8765/oauth/callback";

/// Generate a random state string for CSRF protection.
fn generate_state() -> String {
    let bytes: [u8; 32] = rand::thread_rng().gen();
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Generate PKCE code verifier and challenge.
fn generate_pkce() -> (String, String) {
    let verifier_bytes: [u8; 32] = rand::thread_rng().gen();
    let code_verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);
    
    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let hash = hasher.finalize();
    let code_challenge = URL_SAFE_NO_PAD.encode(hash);
    
    (code_verifier, code_challenge)
}

/// Start an OAuth flow - generate auth URL and flow state.
pub fn start_flow(
    provider_id: &str,
    server_id: &str,
    scopes: &[String],
    credentials: &OAuthCredentials,
) -> Result<(String, OAuthFlowState), String> {
    let config = get_provider_config(provider_id)
        .ok_or_else(|| format!("Unknown provider: {}", provider_id))?;
    
    let state = generate_state();
    let (code_verifier, code_challenge) = if config.pkce_enabled {
        let (v, c) = generate_pkce();
        (Some(v), Some(c))
    } else {
        (None, None)
    };
    
    // Build authorization URL
    let mut url = Url::parse(&config.authorization_url)
        .map_err(|e| format!("Invalid authorization URL: {}", e))?;
    
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("client_id", &credentials.client_id);
        query.append_pair("redirect_uri", CALLBACK_URL);
        query.append_pair("response_type", "code");
        query.append_pair("state", &state);
        
        if !scopes.is_empty() {
            query.append_pair("scope", &scopes.join(" "));
        }
        
        // Add PKCE if enabled
        if let Some(ref challenge) = code_challenge {
            query.append_pair("code_challenge", challenge);
            query.append_pair("code_challenge_method", "S256");
        }
        
        // Google-specific: request offline access for refresh token
        if provider_id == "google" {
            query.append_pair("access_type", "offline");
            query.append_pair("prompt", "consent"); // Force consent to get refresh token
        }
    }
    
    let flow_state = OAuthFlowState {
        state: state.clone(),
        code_verifier,
        provider_id: provider_id.to_string(),
        server_id: server_id.to_string(),
        scopes: scopes.to_vec(),
        started_at: chrono::Utc::now().timestamp_millis(),
    };
    
    tracing::info!(
        "Started OAuth flow for {} (server: {}, scopes: {:?})",
        provider_id,
        server_id,
        scopes
    );
    
    Ok((url.to_string(), flow_state))
}

/// Exchange authorization code for tokens.
pub async fn exchange_code(
    code: &str,
    flow: &OAuthFlowState,
    credentials: &OAuthCredentials,
) -> Result<OAuthTokens, String> {
    let config = get_provider_config(&flow.provider_id)
        .ok_or_else(|| format!("Unknown provider: {}", flow.provider_id))?;
    
    // Build token request
    let mut params = vec![
        ("client_id", credentials.client_id.as_str()),
        ("client_secret", credentials.client_secret.as_str()),
        ("code", code),
        ("redirect_uri", CALLBACK_URL),
        ("grant_type", "authorization_code"),
    ];
    
    // Add PKCE verifier if we used it
    let verifier_str;
    if let Some(ref verifier) = flow.code_verifier {
        verifier_str = verifier.clone();
        params.push(("code_verifier", &verifier_str));
    }
    
    tracing::info!("Exchanging code for tokens (provider: {})", flow.provider_id);
    
    let client = reqwest::Client::new();
    let response = client
        .post(&config.token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token request failed: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        tracing::error!("Token exchange failed: {} - {}", status, body);
        return Err(format!("Token exchange failed: {} - {}", status, body));
    }
    
    let token_response: TokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;
    
    let expires_at = token_response
        .expires_in
        .map(|secs| chrono::Utc::now().timestamp_millis() + (secs as i64 * 1000));
    
    let tokens = OAuthTokens {
        access_token: token_response.access_token,
        refresh_token: token_response.refresh_token,
        expires_at,
        token_type: token_response.token_type.unwrap_or_else(|| "Bearer".to_string()),
        scope: token_response.scope,
    };
    
    tracing::info!(
        "Token exchange successful (has refresh: {})",
        tokens.refresh_token.is_some()
    );
    
    Ok(tokens)
}

/// Refresh an expired access token.
#[allow(dead_code)]
pub async fn refresh_tokens(
    refresh_token: &str,
    provider_id: &str,
    credentials: &OAuthCredentials,
) -> Result<OAuthTokens, String> {
    let config = get_provider_config(provider_id)
        .ok_or_else(|| format!("Unknown provider: {}", provider_id))?;
    
    let params = [
        ("client_id", credentials.client_id.as_str()),
        ("client_secret", credentials.client_secret.as_str()),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];
    
    tracing::info!("Refreshing token (provider: {})", provider_id);
    
    let client = reqwest::Client::new();
    let response = client
        .post(&config.token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Token refresh failed: {} - {}", status, body));
    }
    
    let token_response: TokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;
    
    let expires_at = token_response
        .expires_in
        .map(|secs| chrono::Utc::now().timestamp_millis() + (secs as i64 * 1000));
    
    let tokens = OAuthTokens {
        access_token: token_response.access_token,
        // Some providers return a new refresh token, some don't
        refresh_token: token_response.refresh_token.or_else(|| Some(refresh_token.to_string())),
        expires_at,
        token_type: token_response.token_type.unwrap_or_else(|| "Bearer".to_string()),
        scope: token_response.scope,
    };
    
    tracing::info!("Token refresh successful");
    
    Ok(tokens)
}

/// Token response from OAuth provider.
#[derive(Debug, serde::Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    token_type: Option<String>,
    scope: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_generate_state() {
        let state = generate_state();
        assert!(!state.is_empty());
        assert!(state.len() > 20);
    }
    
    #[test]
    fn test_generate_pkce() {
        let (verifier, challenge) = generate_pkce();
        assert!(!verifier.is_empty());
        assert!(!challenge.is_empty());
        assert_ne!(verifier, challenge);
    }
}
