/**
 * Gmail MCP Server - Harbor Compatible Version
 * 
 * This is a simplified version of the Gmail MCP Server that runs in Harbor's
 * sandboxed JS runtime. It uses:
 * - fetch() for Gmail API calls (instead of googleapis SDK)
 * - MCP.readLine/MCP.writeLine (instead of @modelcontextprotocol/sdk)
 * - process.env for OAuth tokens (Harbor handles OAuth externally)
 * 
 * Features implemented:
 * - search_emails: Search emails with Gmail query syntax
 * - read_email: Read a specific email by ID
 * - send_email: Send emails (text/HTML, no attachments)
 * - list_email_labels: List all Gmail labels
 * - modify_email: Add/remove labels from emails
 * - delete_email: Delete an email
 * 
 * Requires these secrets in manifest:
 * - GMAIL_ACCESS_TOKEN: OAuth access token
 */

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ============================================================================
// Gmail API Helpers
// ============================================================================

async function gmailFetch(endpoint, options = {}) {
  const accessToken = process.env.GMAIL_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('GMAIL_ACCESS_TOKEN not configured');
  }

  const url = endpoint.startsWith('http') ? endpoint : `${GMAIL_API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gmail API error (${response.status}): ${error}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

// Base64 URL encoding/decoding (Gmail uses URL-safe base64)
function base64UrlEncode(str) {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str) {
  // Add padding back
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) {
    padded += '=';
  }
  return atob(padded);
}

// ============================================================================
// Email Content Extraction
// ============================================================================

function extractEmailContent(messagePart) {
  let textContent = '';
  let htmlContent = '';

  if (messagePart.body && messagePart.body.data) {
    const content = base64UrlDecode(messagePart.body.data);
    
    if (messagePart.mimeType === 'text/plain') {
      textContent = content;
    } else if (messagePart.mimeType === 'text/html') {
      htmlContent = content;
    }
  }

  if (messagePart.parts && messagePart.parts.length > 0) {
    for (const part of messagePart.parts) {
      const { text, html } = extractEmailContent(part);
      if (text) textContent += text;
      if (html) htmlContent += html;
    }
  }

  return { text: textContent, html: htmlContent };
}

function extractAttachments(messagePart, attachments = []) {
  if (messagePart.body && messagePart.body.attachmentId) {
    attachments.push({
      id: messagePart.body.attachmentId,
      filename: messagePart.filename || `attachment-${messagePart.body.attachmentId}`,
      mimeType: messagePart.mimeType || 'application/octet-stream',
      size: messagePart.body.size || 0,
    });
  }

  if (messagePart.parts) {
    for (const part of messagePart.parts) {
      extractAttachments(part, attachments);
    }
  }

  return attachments;
}

// ============================================================================
// Email Creation
// ============================================================================

function encodeEmailHeader(text) {
  // Check for non-ASCII characters
  if (/[^\x00-\x7F]/.test(text)) {
    return '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(text))) + '?=';
  }
  return text;
}

function createEmailMessage(args) {
  const encodedSubject = encodeEmailHeader(args.subject);
  const mimeType = args.htmlBody ? 'multipart/alternative' : (args.mimeType || 'text/plain');
  const boundary = `----=_NextPart_${Math.random().toString(36).substring(2)}`;

  const emailParts = [
    'From: me',
    `To: ${args.to.join(', ')}`,
    args.cc ? `Cc: ${args.cc.join(', ')}` : '',
    args.bcc ? `Bcc: ${args.bcc.join(', ')}` : '',
    `Subject: ${encodedSubject}`,
    args.inReplyTo ? `In-Reply-To: ${args.inReplyTo}` : '',
    args.inReplyTo ? `References: ${args.inReplyTo}` : '',
    'MIME-Version: 1.0',
  ].filter(Boolean);

  if (mimeType === 'multipart/alternative') {
    emailParts.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    emailParts.push('');
    
    // Plain text part
    emailParts.push(`--${boundary}`);
    emailParts.push('Content-Type: text/plain; charset=UTF-8');
    emailParts.push('Content-Transfer-Encoding: 7bit');
    emailParts.push('');
    emailParts.push(args.body);
    emailParts.push('');
    
    // HTML part
    emailParts.push(`--${boundary}`);
    emailParts.push('Content-Type: text/html; charset=UTF-8');
    emailParts.push('Content-Transfer-Encoding: 7bit');
    emailParts.push('');
    emailParts.push(args.htmlBody || args.body);
    emailParts.push('');
    
    emailParts.push(`--${boundary}--`);
  } else if (mimeType === 'text/html') {
    emailParts.push('Content-Type: text/html; charset=UTF-8');
    emailParts.push('Content-Transfer-Encoding: 7bit');
    emailParts.push('');
    emailParts.push(args.htmlBody || args.body);
  } else {
    emailParts.push('Content-Type: text/plain; charset=UTF-8');
    emailParts.push('Content-Transfer-Encoding: 7bit');
    emailParts.push('');
    emailParts.push(args.body);
  }

  return emailParts.join('\r\n');
}

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS = [
  {
    name: 'search_emails',
    description: 'Searches for emails using Gmail search syntax (e.g., "from:example@gmail.com", "subject:meeting", "after:2024/01/01")',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query' },
        maxResults: { type: 'number', description: 'Maximum number of results (default: 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_email',
    description: 'Retrieves the full content of a specific email by ID',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'ID of the email message' },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'send_email',
    description: 'Sends a new email. Supports plain text and HTML content.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (plain text)' },
        htmlBody: { type: 'string', description: 'HTML version of the email body (optional)' },
        cc: { type: 'array', items: { type: 'string' }, description: 'CC recipients (optional)' },
        bcc: { type: 'array', items: { type: 'string' }, description: 'BCC recipients (optional)' },
        threadId: { type: 'string', description: 'Thread ID to reply to (optional)' },
        inReplyTo: { type: 'string', description: 'Message ID being replied to (optional)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'list_email_labels',
    description: 'Retrieves all available Gmail labels (system and user-created)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'modify_email',
    description: 'Adds or removes labels from an email (move to folders, mark as read/unread, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'ID of the email message' },
        addLabelIds: { type: 'array', items: { type: 'string' }, description: 'Labels to add' },
        removeLabelIds: { type: 'array', items: { type: 'string' }, description: 'Labels to remove' },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'delete_email',
    description: 'Permanently deletes an email',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'ID of the email message to delete' },
      },
      required: ['messageId'],
    },
  },
];

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleSearchEmails(args) {
  const maxResults = args.maxResults || 10;
  const data = await gmailFetch(`/messages?q=${encodeURIComponent(args.query)}&maxResults=${maxResults}`);
  
  const messages = data.messages || [];
  if (messages.length === 0) {
    return 'No emails found matching your query.';
  }

  // Fetch metadata for each message
  const results = await Promise.all(
    messages.map(async (msg) => {
      const detail = await gmailFetch(`/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
      const headers = detail.payload?.headers || [];
      return {
        id: msg.id,
        subject: headers.find(h => h.name === 'Subject')?.value || '(no subject)',
        from: headers.find(h => h.name === 'From')?.value || '',
        date: headers.find(h => h.name === 'Date')?.value || '',
      };
    })
  );

  return results.map(r => 
    `ID: ${r.id}\nSubject: ${r.subject}\nFrom: ${r.from}\nDate: ${r.date}`
  ).join('\n\n');
}

async function handleReadEmail(args) {
  const data = await gmailFetch(`/messages/${args.messageId}?format=full`);
  
  const headers = data.payload?.headers || [];
  const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '';
  const from = headers.find(h => h.name?.toLowerCase() === 'from')?.value || '';
  const to = headers.find(h => h.name?.toLowerCase() === 'to')?.value || '';
  const date = headers.find(h => h.name?.toLowerCase() === 'date')?.value || '';
  const threadId = data.threadId || '';

  const { text, html } = extractEmailContent(data.payload || {});
  const body = text || html || '(empty)';
  const contentTypeNote = !text && html ? '[Note: This email is HTML-formatted.]\n\n' : '';

  const attachments = extractAttachments(data.payload || {});
  const attachmentInfo = attachments.length > 0
    ? `\n\nAttachments (${attachments.length}):\n` +
      attachments.map(a => `- ${a.filename} (${a.mimeType}, ${Math.round(a.size/1024)} KB)`).join('\n')
    : '';

  return `Thread ID: ${threadId}\nSubject: ${subject}\nFrom: ${from}\nTo: ${to}\nDate: ${date}\n\n${contentTypeNote}${body}${attachmentInfo}`;
}

async function handleSendEmail(args) {
  const message = createEmailMessage(args);
  const encodedMessage = base64UrlEncode(message);

  const requestBody = { raw: encodedMessage };
  if (args.threadId) {
    requestBody.threadId = args.threadId;
  }

  const result = await gmailFetch('/messages/send', {
    method: 'POST',
    body: JSON.stringify(requestBody),
  });

  return `Email sent successfully with ID: ${result.id}`;
}

async function handleListEmailLabels() {
  const data = await gmailFetch('/labels');
  const labels = data.labels || [];
  
  const systemLabels = labels.filter(l => l.type === 'system');
  const userLabels = labels.filter(l => l.type === 'user');

  let result = `Found ${labels.length} labels (${systemLabels.length} system, ${userLabels.length} user):\n\n`;
  result += 'System Labels:\n';
  result += systemLabels.map(l => `  ${l.name} (${l.id})`).join('\n');
  result += '\n\nUser Labels:\n';
  result += userLabels.length > 0 
    ? userLabels.map(l => `  ${l.name} (${l.id})`).join('\n')
    : '  (none)';

  return result;
}

async function handleModifyEmail(args) {
  const requestBody = {};
  if (args.addLabelIds) requestBody.addLabelIds = args.addLabelIds;
  if (args.removeLabelIds) requestBody.removeLabelIds = args.removeLabelIds;

  await gmailFetch(`/messages/${args.messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify(requestBody),
  });

  return `Email ${args.messageId} labels updated successfully`;
}

async function handleDeleteEmail(args) {
  await gmailFetch(`/messages/${args.messageId}`, {
    method: 'DELETE',
  });

  return `Email ${args.messageId} deleted successfully`;
}

// ============================================================================
// MCP Server Main Loop
// ============================================================================

async function handleRequest(request) {
  const { method, params, id } = request;

  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'gmail-harbor', version: '1.0.0' },
        },
      };
    }

    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      };
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};
      let resultText;

      switch (toolName) {
        case 'search_emails':
          resultText = await handleSearchEmails(args);
          break;
        case 'read_email':
          resultText = await handleReadEmail(args);
          break;
        case 'send_email':
          resultText = await handleSendEmail(args);
          break;
        case 'list_email_labels':
          resultText = await handleListEmailLabels();
          break;
        case 'modify_email':
          resultText = await handleModifyEmail(args);
          break;
        case 'delete_email':
          resultText = await handleDeleteEmail(args);
          break;
        default:
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Unknown tool: ${toolName}` },
          };
      }

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: resultText }],
        },
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: error.message || String(error) },
    };
  }
}

async function main() {
  console.log('Gmail MCP Server (Harbor) starting...');
  console.log('Access token configured:', !!process.env.GMAIL_ACCESS_TOKEN);

  while (true) {
    const line = await MCP.readLine();
    let request;
    
    try {
      request = JSON.parse(line);
    } catch (e) {
      console.error('Failed to parse request:', e);
      continue;
    }

    const response = await handleRequest(request);
    MCP.writeLine(JSON.stringify(response));
  }
}

main().catch(err => console.error('Gmail server error:', err));
