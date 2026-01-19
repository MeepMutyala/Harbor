import type { McpRequest, McpResponse } from './protocol';

export interface McpTransport {
  send(request: McpRequest): Promise<McpResponse>;
}

export class UnwiredTransport implements McpTransport {
  async send(request: McpRequest): Promise<McpResponse> {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32000,
        message: 'WASM transport not wired',
      },
    };
  }
}
