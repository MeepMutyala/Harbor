#!/usr/bin/env npx ts-node
/**
 * Test script for Harbor's Google OAuth setup.
 * 
 * This verifies that your Google Cloud project is configured correctly
 * for the "clientIdSource: harbor" OAuth flow.
 * 
 * Usage:
 *   # Option 1: Use credentials.env file (recommended)
 *   # Make sure installer/credentials.env has HARBOR_GOOGLE_CLIENT_ID and SECRET
 *   npx ts-node scripts/test-harbor-oauth.ts
 *   
 *   # Option 2: Set environment variables directly
 *   export HARBOR_GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
 *   export HARBOR_GOOGLE_CLIENT_SECRET="GOCSPX-your-secret"
 *   npx ts-node scripts/test-harbor-oauth.ts
 *   
 *   # Test with specific scopes
 *   npx ts-node scripts/test-harbor-oauth.ts "gmail.modify" "gmail.settings.basic"
 */

import { createServer } from 'node:http';
import { URL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load credentials from installer/credentials.env if it exists
function loadCredentialsEnv(): void {
  // Find the project root (go up from bridge-ts/scripts/)
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = join(scriptDir, '..', '..');
  const credentialsPath = join(projectRoot, 'installer', 'credentials.env');
  
  if (existsSync(credentialsPath)) {
    console.log(`📁 Loading credentials from: installer/credentials.env\n`);
    const content = readFileSync(credentialsPath, 'utf-8');
    
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      // Parse KEY="value" or KEY=value
      const match = trimmed.match(/^([A-Z_]+)=["']?([^"']*)["']?$/);
      if (match) {
        const [, key, value] = match;
        // Only set if not already in environment (env vars take precedence)
        if (!process.env[key] && value) {
          process.env[key] = value;
        }
      }
    }
  } else {
    console.log(`📁 No credentials.env found, using environment variables\n`);
  }
}

// Load credentials before anything else
loadCredentialsEnv();

// Cross-platform browser open
function openBrowser(url: string): void {
  const plat = platform();
  const cmd = plat === 'darwin' ? 'open' 
            : plat === 'win32' ? 'start' 
            : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

// Configuration
const CLIENT_ID = process.env.HARBOR_GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.HARBOR_GOOGLE_CLIENT_SECRET;
const REDIRECT_PORT = 8914;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

// Default scopes to test (Gmail)
const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.settings.basic',
];

// Parse command line scopes
const argScopes = process.argv.slice(2);
const SCOPES = argScopes.length > 0 
  ? argScopes.map(s => s.startsWith('https://') ? s : `https://www.googleapis.com/auth/${s}`)
  : DEFAULT_SCOPES;

async function main() {
  console.log('🔐 Harbor Google OAuth Test\n');
  
  // Check credentials
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('❌ Missing credentials!\n');
    console.error('Set these environment variables:');
    console.error('  export HARBOR_GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"');
    console.error('  export HARBOR_GOOGLE_CLIENT_SECRET="GOCSPX-your-secret"');
    process.exit(1);
  }
  
  console.log('Configuration:');
  console.log(`  Client ID: ${CLIENT_ID.substring(0, 20)}...`);
  console.log(`  Redirect:  ${REDIRECT_URI}`);
  console.log(`  Scopes:    ${SCOPES.length}`);
  SCOPES.forEach(s => console.log(`    - ${s.replace('https://www.googleapis.com/auth/', '')}`));
  console.log('');
  
  // Generate state for CSRF protection
  const state = randomBytes(16).toString('hex');
  
  // Build authorization URL
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'offline'); // Get refresh token
  authUrl.searchParams.set('prompt', 'consent'); // Force consent to get refresh token
  
  // Start callback server
  const tokens = await new Promise<{ access_token: string; refresh_token?: string; expires_in: number }>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${REDIRECT_PORT}`);
      
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      
      // Check for error
      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400);
        res.end(`Error: ${error}`);
        server.close();
        reject(new Error(error));
        return;
      }
      
      // Verify state
      const returnedState = url.searchParams.get('state');
      if (returnedState !== state) {
        res.writeHead(400);
        res.end('State mismatch - possible CSRF attack');
        server.close();
        reject(new Error('State mismatch'));
        return;
      }
      
      // Get authorization code
      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('No code received');
        server.close();
        reject(new Error('No code'));
        return;
      }
      
      console.log('✓ Received authorization code');
      
      // Exchange code for tokens
      try {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: CLIENT_ID!,
            client_secret: CLIENT_SECRET!,
            code,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI,
          }),
        });
        
        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          throw new Error(`Token exchange failed: ${errorText}`);
        }
        
        const tokens = await tokenResponse.json() as {
          access_token: string;
          refresh_token?: string;
          expires_in: number;
          scope: string;
          token_type: string;
        };
        
        // Send success page
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head><title>OAuth Success</title></head>
          <body style="font-family: system-ui; padding: 40px; text-align: center;">
            <h1>✅ OAuth Successful!</h1>
            <p>You can close this window and return to the terminal.</p>
          </body>
          </html>
        `);
        
        server.close();
        resolve(tokens);
        
      } catch (e) {
        res.writeHead(500);
        res.end(`Token exchange failed: ${e}`);
        server.close();
        reject(e);
      }
    });
    
    server.listen(REDIRECT_PORT, () => {
      console.log(`Callback server listening on port ${REDIRECT_PORT}`);
      console.log('\n🌐 Opening browser for Google sign-in...\n');
      console.log(`If browser doesn't open, visit:\n${authUrl.toString()}\n`);
      openBrowser(authUrl.toString());
    });
    
    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Timeout waiting for OAuth callback'));
    }, 120000);
  });
  
  console.log('✓ Token exchange successful!\n');
  
  // Display tokens
  console.log('Tokens received:');
  console.log(`  Access Token:  ${tokens.access_token.substring(0, 30)}...`);
  console.log(`  Refresh Token: ${tokens.refresh_token ? tokens.refresh_token.substring(0, 20) + '...' : '(none)'}`);
  console.log(`  Expires In:    ${tokens.expires_in} seconds`);
  console.log('');
  
  // Test the token by calling userinfo endpoint
  console.log('Testing token by fetching user info...');
  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
    },
  });
  
  if (userInfoResponse.ok) {
    const userInfo = await userInfoResponse.json() as { email: string; name?: string };
    console.log(`✓ Token works! Authenticated as: ${userInfo.email}\n`);
  } else {
    console.log(`⚠ Could not fetch user info (may need userinfo scope)\n`);
  }
  
  // Test Gmail API if Gmail scopes were requested
  if (SCOPES.some(s => s.includes('gmail'))) {
    console.log('Testing Gmail API access...');
    const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
      },
    });
    
    if (gmailResponse.ok) {
      const profile = await gmailResponse.json() as { emailAddress: string; messagesTotal: number };
      console.log(`✓ Gmail API works! Email: ${profile.emailAddress}, Messages: ${profile.messagesTotal}\n`);
    } else {
      const error = await gmailResponse.text();
      console.log(`❌ Gmail API failed: ${error}\n`);
    }
  }
  
  // Output environment variables for testing MCP server
  console.log('━'.repeat(60));
  console.log('To test an MCP server with these tokens, use:\n');
  console.log(`export GMAIL_ACCESS_TOKEN="${tokens.access_token}"`);
  if (tokens.refresh_token) {
    console.log(`export GMAIL_REFRESH_TOKEN="${tokens.refresh_token}"`);
  }
  console.log(`export GMAIL_CLIENT_ID="${CLIENT_ID}"`);
  console.log(`export GMAIL_CLIENT_SECRET="${CLIENT_SECRET}"`);
  console.log('');
  console.log('Then run your MCP server:');
  console.log('  npx @gongrzhe/server-gmail-autoauth-mcp');
  console.log('━'.repeat(60));
  
  console.log('\n✅ Harbor OAuth test complete!');
}

main().catch(e => {
  console.error('❌ Test failed:', e.message);
  process.exit(1);
});

