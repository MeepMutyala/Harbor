export type WasmServerManifest = {
  id: string;
  name: string;
  version: string;
  entrypoint: string;
  moduleUrl?: string;
  moduleBytesBase64?: string;
  permissions: string[];
  env?: string[];
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
};

export type WasmServerHandle = {
  id: string;
  manifest: WasmServerManifest;
};
