//! OAuth provider configurations.
//!
//! Defines the OAuth endpoints and settings for supported providers.

use super::OAuthProviderConfig;

/// Google OAuth configuration.
pub fn google_config() -> OAuthProviderConfig {
    OAuthProviderConfig {
        provider_id: "google".to_string(),
        display_name: "Google".to_string(),
        authorization_url: "https://accounts.google.com/o/oauth2/v2/auth".to_string(),
        token_url: "https://oauth2.googleapis.com/token".to_string(),
        revocation_url: Some("https://oauth2.googleapis.com/revoke".to_string()),
        pkce_enabled: true,
    }
}

/// GitHub OAuth configuration.
pub fn github_config() -> OAuthProviderConfig {
    OAuthProviderConfig {
        provider_id: "github".to_string(),
        display_name: "GitHub".to_string(),
        authorization_url: "https://github.com/login/oauth/authorize".to_string(),
        token_url: "https://github.com/login/oauth/access_token".to_string(),
        revocation_url: None,
        pkce_enabled: false, // GitHub doesn't support PKCE yet
    }
}

/// Get provider config by ID.
pub fn get_provider_config(provider_id: &str) -> Option<OAuthProviderConfig> {
    match provider_id {
        "google" => Some(google_config()),
        "github" => Some(github_config()),
        _ => None,
    }
}

/// Common Google OAuth scopes.
#[allow(dead_code)]
pub mod google_scopes {
    // Gmail
    pub const GMAIL_READONLY: &str = "https://www.googleapis.com/auth/gmail.readonly";
    pub const GMAIL_SEND: &str = "https://www.googleapis.com/auth/gmail.send";
    pub const GMAIL_MODIFY: &str = "https://www.googleapis.com/auth/gmail.modify";
    
    // Drive
    pub const DRIVE_READONLY: &str = "https://www.googleapis.com/auth/drive.readonly";
    pub const DRIVE_FILE: &str = "https://www.googleapis.com/auth/drive.file";
    pub const DRIVE_FULL: &str = "https://www.googleapis.com/auth/drive";
    
    // Calendar
    pub const CALENDAR_READONLY: &str = "https://www.googleapis.com/auth/calendar.readonly";
    pub const CALENDAR_EVENTS: &str = "https://www.googleapis.com/auth/calendar.events";
    
    // User info
    pub const USERINFO_EMAIL: &str = "https://www.googleapis.com/auth/userinfo.email";
    pub const USERINFO_PROFILE: &str = "https://www.googleapis.com/auth/userinfo.profile";
    pub const OPENID: &str = "openid";
}

/// Common GitHub OAuth scopes.
#[allow(dead_code)]
pub mod github_scopes {
    pub const REPO: &str = "repo";
    pub const READ_USER: &str = "read:user";
    pub const USER_EMAIL: &str = "user:email";
    pub const GIST: &str = "gist";
}
