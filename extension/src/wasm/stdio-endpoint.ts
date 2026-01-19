import type { McpRequest, McpResponse } from '../mcp/protocol';
import type { StdioEndpoint } from '../mcp/stdio-transport';

export function createStubEndpoint(): StdioEndpoint {
  let handler: ((data: Uint8Array) => void) | null = null;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';

  const flushResponse = (response: McpResponse) => {
    if (!handler) {
      return;
    }
    const line = JSON.stringify(response) + '\n';
    handler(encoder.encode(line));
  };

  const handleRequestLine = (line: string) => {
    let request: McpRequest | null = null;
    try {
      request = JSON.parse(line) as McpRequest;
    } catch (error) {
      return;
    }
    if (!request?.id) {
      return;
    }
    flushResponse({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32000,
        message: 'WASM stdio endpoint not wired',
      },
    });
  };

  return {
    write(data: Uint8Array) {
      buffer += decoder.decode(data, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          handleRequestLine(line);
        }
        newlineIndex = buffer.indexOf('\n');
      }
    },
    onData(nextHandler: (data: Uint8Array) => void) {
      handler = nextHandler;
    },
  };
}
