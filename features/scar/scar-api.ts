export interface Workspace {
  id: string;
  name: string;
  kind: "PERSONAL" | "ORGANIZATION";
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: "ACTIVE" | "SUSPENDED";
  permissions: Array<"USDC_TRANSFER">;
}

export type AgentCredentialOperation =
  | "PROPOSE_ACTION"
  | "EVALUATE_ACTION"
  | "EXECUTE_ACTION"
  | "READ_ACTION";

export interface AgentCredential {
  id: string;
  workspaceId: string;
  agentId: string;
  allowedOperations: AgentCredentialOperation[];
  status: "ACTIVE";
  createdAt: string;
  expiresAt: string;
}

/**
 * This bearer value is assembled only in the caller after a metadata-only API
 * response. It is never part of an API response or persisted by the browser.
 */
export interface LocallyProvisionedAgentCredential {
  credential: AgentCredential;
  token: string;
}

export interface EvidenceReference {
  kind: "TRANSACTION" | "OPERATOR_NOTE" | "SYSTEM_EVENT";
  reference: string;
  observedAt: string;
}

export interface Authorization {
  id: string;
  actionId: string;
  decision: "ALLOW" | "REVIEW" | "BLOCK";
  reasonCode: string;
  rationale: string;
  evidence: EvidenceReference[];
  provenance: { engine: "SCAR_DETERMINISTIC_POLICY"; policyVersion: string; evaluatedAt: string };
}

export interface Approval {
  id: string;
  actionId: string;
  authorizationId: string;
  approvedBy: string;
  approvedAt: string;
}

export interface Execution {
  id: string;
  actionId: string;
  authorizationId: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED";
  startedAt: string;
  completedAt?: string;
  externalReference?: string;
  errorCode?: string;
}

export interface Incident {
  id: string;
  sourceAgentId: string;
  relatedActionId: string;
  entityId: string;
  actionType: "USDC_TRANSFER";
  context: string;
  outcome: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reason: string;
  mitigation: string;
  evidence: EvidenceReference[];
  provenance: { source: "OPERATOR_REPORT" | "EXECUTION_OUTCOME"; recordedBy: string; observedAt: string };
  createdAt: string;
}

export interface ActionState {
  action: {
    id: string;
    agentId: string;
    actionType: "USDC_TRANSFER";
    amountAtomic: string;
    entityId: string;
    recipient: string;
    chainId: number;
    proposedAt: string;
  };
  authorization: Authorization | null;
  approval: Approval | null;
  execution: Execution | null;
  incidents: Incident[];
}

export class ScarApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly incidentId?: string,
    readonly memoryShared?: boolean,
  ) {
    super(code);
    this.name = "ScarApiError";
  }
}

export interface IncidentInput {
  entity: { name: string; externalIdentifier: string; type: "COUNTERPARTY" | "SERVICE" | "TOOL" };
  context: string;
  outcome: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reason: string;
  mitigation: string;
  evidence: EvidenceReference[];
  safeguard: { requiredResponse: "REVIEW" | "BLOCK"; reason: string; scopeAgentIds: string[] };
}

export class ScarApiClient {
  constructor(
    private readonly accessToken: () => string | null,
    private readonly onUnauthenticated?: () => void | Promise<void>,
    private readonly request: typeof fetch = fetch,
  ) {}

  listWorkspaces() { return this.get<{ workspaces: Workspace[] }>("/api/scar/workspaces"); }
  createWorkspace(input: { name: string; kind: Workspace["kind"] }) {
    return this.send<{ workspace: Workspace }>("/api/scar/workspaces", "POST", input);
  }
  assignWorkspaceRole(workspaceId: string, userId: string, role: "ADMIN" | "OPERATOR" | "APPROVER" | "SAFETY_OFFICER") {
    return this.send<{ roleAudit: unknown }>(`${workspacePath(workspaceId)}/members/${encodeURIComponent(userId)}/roles/${role}`, "POST");
  }
  listAgents(workspaceId: string) {
    return this.get<{ agents: Agent[] }>(`${workspacePath(workspaceId)}/agents`);
  }
  registerAgent(workspaceId: string, input: Agent) {
    return this.send<{ agent: Agent }>(`${workspacePath(workspaceId)}/agents`, "POST", input);
  }
  getAgent(workspaceId: string, agentId: string) {
    return this.get<{ agent: Agent }>(`${workspacePath(workspaceId)}/agents/${encodeURIComponent(agentId)}`);
  }
  async issueAgentCredential(
    workspaceId: string,
    agentId: string,
    input: { allowedOperations: AgentCredentialOperation[]; expiresAt: string },
  ): Promise<LocallyProvisionedAgentCredential> {
    const secret = createAgentCredentialSecret();
    const response = await this.send<{ credential: AgentCredential }>(
      `${workspacePath(workspaceId)}/agents/${encodeURIComponent(agentId)}/credentials`,
      "POST",
      { ...input, secret },
    );
    return {
      credential: response.credential,
      token: `Bearer scar_agent_${response.credential.workspaceId}.${response.credential.id}.${secret}`,
    };
  }
  listActionStates(workspaceId: string) {
    return this.get<{ states: ActionState[] }>(`${workspacePath(workspaceId)}/actions`);
  }
  getActionState(workspaceId: string, actionId: string) {
    return this.get<{ state: ActionState }>(`${workspacePath(workspaceId)}/actions/${encodeURIComponent(actionId)}`);
  }
  proposeAction(workspaceId: string, input: Omit<ActionState["action"], "id" | "proposedAt">) {
    return this.send<{ action: ActionState["action"] }>(
      `${workspacePath(workspaceId)}/actions`, "POST", input, true,
    );
  }
  evaluateAction(workspaceId: string, actionId: string) {
    return this.send<{ authorization: Authorization }>(`${actionPath(workspaceId, actionId)}/evaluate`, "POST");
  }
  approveAction(workspaceId: string, actionId: string, authorizationId: string) {
    return this.send<{ approval: Approval }>(`${actionPath(workspaceId, actionId)}/approvals`, "POST", { authorizationId });
  }
  executeAction(workspaceId: string, actionId: string, approvalId?: string) {
    return this.send<{ result: { status: string; execution?: Execution } }>(`${actionPath(workspaceId, actionId)}/execute`, "POST", approvalId ? { approvalId } : {});
  }
  recordIncident(workspaceId: string, actionId: string, input: IncidentInput) {
    return this.send<{ incident: Incident; memoryShared: true }>(`${actionPath(workspaceId, actionId)}/incidents`, "POST", input, true);
  }
  retryIncident(workspaceId: string, actionId: string, incidentId: string) {
    return this.send<{ incident: Incident; memoryShared: true }>(`${actionPath(workspaceId, actionId)}/incidents/${encodeURIComponent(incidentId)}/retry`, "POST");
  }

  private get<T>(path: string) { return this.call<T>(path, { method: "GET" }); }
  private send<T>(path: string, method: "POST", body?: unknown, idempotent = false) {
    return this.call<T>(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      idempotent,
    });
  }
  private async call<T>(path: string, init: RequestInit & { idempotent?: boolean }): Promise<T> {
    const token = this.accessToken();
    if (!token) throw new ScarApiError(401, "UNAUTHENTICATED");
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (init.idempotent) headers.set("idempotency-key", createIdempotencyKey());
    const response = await this.request(path, { ...init, headers });
    const body = await response.json().catch(() => ({})) as {
      error?: { code?: string };
      incidentId?: string;
      memoryShared?: boolean;
    };
    if (!response.ok) {
      const error = new ScarApiError(
        response.status,
        body.error?.code ?? "REQUEST_FAILED",
        body.incidentId,
        body.memoryShared,
      );
      if (error.status === 401) await this.onUnauthenticated?.();
      throw error;
    }
    return body as T;
  }
}

function workspacePath(workspaceId: string) {
  return `/api/scar/workspaces/${encodeURIComponent(workspaceId)}`;
}
function actionPath(workspaceId: string, actionId: string) {
  return `${workspacePath(workspaceId)}/actions/${encodeURIComponent(actionId)}`;
}
function createIdempotencyKey() {
  return `ui:${crypto.randomUUID()}`;
}

/** Generates 48 random bytes as exactly 64 unpadded base64url characters. */
export function createAgentCredentialSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const secret = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  if (!/^[A-Za-z0-9_-]{64}$/.test(secret)) {
    throw new Error("Could not generate a valid SCAR agent credential secret.");
  }
  return secret;
}
