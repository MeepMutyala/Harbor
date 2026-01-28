/**
 * My MCP Server - JavaScript Template
 * 
 * This is a starter template for building JavaScript MCP servers.
 * Customize the tools and handlers below for your use case.
 * 
 * Available globals:
 * - MCP.readLine() - Read next JSON-RPC request
 * - MCP.writeLine(str) - Write JSON-RPC response  
 * - fetch(url, opts) - Make HTTP requests (to allowed hosts only)
 * - process.env - Access secrets and environment variables
 * - console.log/warn/error - Logging
 */

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS = [
  {
    name: 'greet',
    description: 'Say hello to someone',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the person to greet'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'add',
    description: 'Add two numbers together',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'First number' },
        b: { type: 'number', description: 'Second number' }
      },
      required: ['a', 'b']
    }
  }
];

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Handle the 'greet' tool
 */
function handleGreet(args) {
  const name = args.name || 'World';
  return `Hello, ${name}!`;
}

/**
 * Handle the 'add' tool
 */
function handleAdd(args) {
  const a = Number(args.a) || 0;
  const b = Number(args.b) || 0;
  const result = a + b;
  return `${a} + ${b} = ${result}`;
}

// ============================================================================
// MCP Protocol Handling
// ============================================================================

/**
 * Route tool calls to handlers
 */
async function handleToolCall(toolName, args) {
  switch (toolName) {
    case 'greet':
      return handleGreet(args);
    case 'add':
      return handleAdd(args);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * Handle incoming MCP requests
 */
async function handleRequest(request) {
  const { method, params, id } = request;

  try {
    // Handle initialize (required by MCP)
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'my-js-server', version: '1.0.0' }
        }
      };
    }

    // Handle tools/list
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS }
      };
    }

    // Handle tools/call
    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};
      
      const resultText = await handleToolCall(toolName, args);
      
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: resultText }]
        }
      };
    }

    // Unknown method
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: error.message || String(error) }
    };
  }
}

// ============================================================================
// Main Loop
// ============================================================================

async function main() {
  console.log('My MCP Server starting...');

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

main().catch(err => console.error('Server error:', err));
