import type { McpRequest, McpResponse } from './protocol';
import type { McpTransport } from './transport';

export type StdioEndpoint = {
  write: (data: Uint8Array) => void;
  onData: (handler: (data: Uint8Array) => void) => void;
};

type PendingRequest = {
  resolve: (response: McpResponse) => void;
  reject: (error: Error) => void;
};

export class McpStdioTransport implements McpTransport {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private readonly pending = new Map<string, PendingRequest>();

  constructor(private readonly endpoint: StdioEndpoint) {
    this.endpoint.onData((data) => this.handleData(data));
  }

  async send(request: McpRequest): Promise<McpResponse> {
    const payload = JSON.stringify(request) + '\n';
    const data = this.encoder.encode(payload);

    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject });
      this.endpoint.write(data);
    });
  }

  private handleData(data: Uint8Array): void {
    this.buffer += this.decoder.decode(data, { stream: true });
    let newlineIndex = this.buffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.handleLine(line);
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let message: McpResponse | null = null;
    try {
      message = JSON.parse(line) as McpResponse;
    } catch (error) {
      return;
    }
    if (!message?.id) {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    pending.resolve(message);
  }
}
