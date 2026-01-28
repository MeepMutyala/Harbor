# Gmail MCP Server

A JavaScript MCP server that integrates with the Gmail API, allowing AI agents to search, read, send, and manage emails.

## Features

| Feature | Status |
|---------|--------|
| Search emails | ✅ |
| Read email content | ✅ |
| Send emails (text/HTML) | ✅ |
| List labels | ✅ |
| Modify labels | ✅ |
| Delete emails | ✅ |
| Attachments (send) | ❌ |
| Attachments (download) | ❌ |

## Tools

### `search_emails`

Search emails using Gmail's query syntax.

**Input:**
```json
{
  "query": "from:notifications@github.com after:2024/01/01",
  "maxResults": 10
}
```

**Output:**
```
ID: 18abc123def
Subject: [repo] New pull request
From: GitHub <notifications@github.com>
Date: Mon, 15 Jan 2024 10:30:00 -0800

ID: 18abc456ghi
Subject: [repo] Issue closed
...
```

### `read_email`

Read the full content of an email by ID.

**Input:**
```json
{
  "messageId": "18abc123def"
}
```

### `send_email`

Send a new email.

**Input:**
```json
{
  "to": ["recipient@example.com"],
  "subject": "Hello from Harbor",
  "body": "This email was sent via Harbor's Gmail MCP server.",
  "htmlBody": "<p>This email was sent via <b>Harbor</b>.</p>",
  "cc": ["cc@example.com"],
  "bcc": ["bcc@example.com"]
}
```

### `list_email_labels`

List all Gmail labels (system and user-created).

**Input:**
```json
{}
```

### `modify_email`

Add or remove labels from an email.

**Input:**
```json
{
  "messageId": "18abc123def",
  "addLabelIds": ["STARRED"],
  "removeLabelIds": ["UNREAD"]
}
```

### `delete_email`

Permanently delete an email.

**Input:**
```json
{
  "messageId": "18abc123def"
}
```

## Installation

### Via Harbor UI

1. Open Harbor sidebar
2. Go to MCP Servers → Add Server
3. Enter the manifest URL or upload `manifest.json`
4. Complete the Google OAuth authorization

### Manual Installation

1. Copy `manifest.json` and `gmail-harbor.js` to your server
2. Add the server in Harbor settings
3. Configure OAuth credentials

## OAuth Configuration

This server requires Google OAuth with the following scopes:

- `gmail.readonly` - Read emails
- `gmail.send` - Send emails
- `gmail.modify` - Modify labels

Harbor handles the OAuth flow automatically. When you first use the server, you'll be prompted to authorize Gmail access.

## Gmail Query Syntax

The `search_emails` tool uses Gmail's native query syntax:

| Query | Description |
|-------|-------------|
| `from:example@gmail.com` | Emails from a specific sender |
| `to:me` | Emails sent to you |
| `subject:meeting` | Emails with "meeting" in subject |
| `has:attachment` | Emails with attachments |
| `after:2024/01/01` | Emails after a date |
| `before:2024/12/31` | Emails before a date |
| `is:unread` | Unread emails |
| `label:important` | Emails with a label |
| `in:inbox` | Emails in inbox |

Combine queries: `from:boss@company.com subject:urgent after:2024/01/01`

## Security

- Runs in Harbor's sandboxed JavaScript runtime
- Only `gmail.googleapis.com` network access is allowed
- No filesystem access
- OAuth tokens are managed securely by Harbor
- Never stores credentials in the server code

## Capabilities Required

```json
{
  "capabilities": {
    "network": {
      "required": true,
      "hosts": ["gmail.googleapis.com"]
    }
  },
  "oauth": {
    "provider": "google",
    "scopes": [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify"
    ]
  }
}
```

## Limitations

1. **No attachments** - The sandbox doesn't have filesystem access
2. **No batch operations** - Simplified implementation
3. **Token refresh** - Harbor must handle token refresh

## Source

This is a simplified, browser-compatible version based on [Gmail-MCP-Server](https://github.com/gongrzhe/Gmail-MCP-Server).

Key differences from the original:
- Uses `fetch()` instead of `googleapis` SDK
- Uses `MCP.readLine/writeLine` instead of `@modelcontextprotocol/sdk`
- No Node.js dependencies
- OAuth handled externally by Harbor

## Files

- `manifest.json` - Server configuration
- `gmail-harbor.js` - Server implementation
- `README.md` - This documentation

## License

MIT
