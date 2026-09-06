/**
 * What shared workflow code needs from the plugin around it. Everything here is host-specific by
 * nature — which models exist, which indexes and MCP servers are configured — so a host registers
 * an implementation at load and shared UI reads it instead of reaching for a plugin type.
 */
export interface WorkflowModelOption {
  value: string;
  label: string;
}

export interface WorkflowHost {
  /** Models offered for a command node, in the order the host wants them shown. */
  getModelOptions(): WorkflowModelOption[];
  /** Names of the configured RAG indexes, empty when the host has none. */
  getRagSettingNames(): string[];
  /** Names of the configured MCP servers, empty when the host has no MCP support. */
  getMcpServerNames(): string[];
}

const noHost: WorkflowHost = {
  getModelOptions: () => [],
  getRagSettingNames: () => [],
  getMcpServerNames: () => [],
};

let host: WorkflowHost = noHost;

export function configureWorkflowHost(next: WorkflowHost): void {
  host = next;
}

export function workflowHost(): WorkflowHost {
  return host;
}
