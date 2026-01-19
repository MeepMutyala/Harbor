export type McpRequest = {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: unknown;
};

export type McpError = {
  code: number;
  message: string;
};

export type McpResponse = {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: McpError;
};

export type ToolCallParams = {
  name: string;
  arguments: Record<string, unknown>;
};
