/**
 * Echo MCP Server (JavaScript)
 * 
 * A simple server for testing Harbor's JavaScript MCP runtime.
 * Demonstrates basic tool implementation with MCP.readLine/writeLine.
 */

async function main() {
  console.log('Echo JS MCP server starting...');
  
  while (true) {
    const line = await MCP.readLine();
    let request;
    
    try {
      request = JSON.parse(line);
    } catch (e) {
      console.error('Failed to parse request:', e);
      continue;
    }
    
    let response;
    
    switch (request.method) {
      case 'initialize':
        response = {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'echo-js', version: '1.0.0' }
          }
        };
        break;

      case 'tools/list':
        response = {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            tools: [
              {
                name: 'echo',
                description: 'Echo back the input message',
                inputSchema: {
                  type: 'object',
                  properties: {
                    message: {
                      type: 'string',
                      description: 'The message to echo back'
                    }
                  },
                  required: ['message']
                }
              },
              {
                name: 'reverse',
                description: 'Reverse a string',
                inputSchema: {
                  type: 'object',
                  properties: {
                    text: {
                      type: 'string',
                      description: 'The text to reverse'
                    }
                  },
                  required: ['text']
                }
              }
            ]
          }
        };
        break;
        
      case 'tools/call':
        const toolName = request.params?.name;
        const args = request.params?.arguments || {};
        
        if (toolName === 'echo') {
          response = {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                { type: 'text', text: 'Echo: ' + (args.message || '(empty)') }
              ]
            }
          };
        } else if (toolName === 'reverse') {
          const reversed = (args.text || '').split('').reverse().join('');
          response = {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                { type: 'text', text: reversed }
              ]
            }
          };
        } else {
          response = {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32601, message: 'Unknown tool: ' + toolName }
          };
        }
        break;
        
      default:
        response = {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: 'Method not found: ' + request.method }
        };
    }
    
    MCP.writeLine(JSON.stringify(response));
  }
}

main().catch(err => console.error('Echo server error:', err));
