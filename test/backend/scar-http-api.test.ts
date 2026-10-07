// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createScarHttpApi,
  type ScarHttpApiDependencies,
} from "@/server/scar/http/api";
import { ScarMemoryPersistenceError } from "@/server/scar/scar-service";

const timestamp = "2026-10-02T12:00:00.000Z";
const operatorId = "123e4567-e89b-12d3-a456-426614174000";

describe("SCAR HTTP API", () => {
  it("derives approval identity and rejects a forged approvedBy field", async () => {
    const approveAction = vi.fn(async (input: unknown) => input);
    const api = createApi({
      principal: { type: "HUMAN", subject: operatorId },
      role: "APPROVER",
      service: {
        approveAction,
        getActionState: async () => actionState({
          authorization: {
            id: "authorization-001",
            actionId: "action-001",
            decision: "REVIEW",
          },
        }),
      },
    });

    const forged = await api.approveAction(
      jsonRequest("https://scar.test/api/scar/actions/action-001/approvals", {
        authorizationId: "authorization-001",
        approvedBy: "forged-operator",
      }),
      "action-001",
    );
    expect(forged.status).toBe(400);
    expect(approveAction).not.toHaveBeenCalled();

    const approved = await api.approveAction(
      jsonRequest("https://scar.test/api/scar/actions/action-001/approvals", {
        authorizationId: "authorization-001",
      }),
      "action-001",
    );
    expect(approved.status).toBe(201);
    expect(approveAction).toHaveBeenCalledWith({
      id: "approval:http-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      approvedBy: operatorId,
      approvedAt: timestamp,
    });
  });

  it("prevents an agent credential from proposing an action for another agent", async () => {
    const proposeAction = vi.fn();
    const api = createApi({
      principal: {
        type: "AGENT",
        subject: "credential-001",
        workspaceId: "workspace-alpha",
        agentId: "agent-treasury",
        allowedOperations: ["PROPOSE_ACTION"],
      },
      service: { proposeAction },
    });

    const response = await api.proposeAction(
      jsonRequest(
        "https://scar.test/api/scar/actions",
        {
          agentId: "agent-procurement",
          actionType: "USDC_TRANSFER",
          amountAtomic: "1000000",
          entityId: "supplier-alpha",
          recipient: "0x1111111111111111111111111111111111111111",
          chainId: 84532,
        },
        { "idempotency-key": "proposal-unique-001" },
      ),
    );

    expect(response.status).toBe(403);
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it("rejects an otherwise valid agent credential at a different workspace route", async () => {
    const proposeAction = vi.fn();
    const api = createApi({
      principal: {
        type: "AGENT",
        subject: "credential-001",
        workspaceId: "workspace-beta",
        agentId: "agent-treasury",
        allowedOperations: ["PROPOSE_ACTION"],
      },
      service: { proposeAction },
    });

    const response = await api.proposeAction(
      jsonRequest(
        "https://scar.test/api/scar/workspaces/workspace-alpha/actions",
        {
          agentId: "agent-treasury",
          actionType: "USDC_TRANSFER",
          amountAtomic: "1000000",
          entityId: "supplier-alpha",
          recipient: "0x1111111111111111111111111111111111111111",
          chainId: 84532,
        },
        { "idempotency-key": "proposal-cross-workspace" },
      ),
    );

    expect(response.status).toBe(404);
    expect(proposeAction).not.toHaveBeenCalled();
  });

  it("rejects execution before the boundary when the workspace configuration is disabled", async () => {
    const executeAction = vi.fn();
    const api = createApi({
      principal: { type: "HUMAN", subject: operatorId },
      role: "OPERATOR",
      executionEnabled: false,
      service: {
        getActionState: async () => actionState({}),
        executeAction,
      },
    });

    const response = await api.executeAction(
      jsonRequest(
        "https://scar.test/api/scar/workspaces/workspace-alpha/actions/action-001/execute",
        {},
      ),
      "action-001",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "EXECUTION_CONFIGURATION_DISABLED" },
    });
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("stops a mutation when the authenticated principal has exceeded its rate limit", async () => {
    const registerAgent = vi.fn();
    const api = createApi({
      principal: { type: "HUMAN", subject: operatorId },
      role: "ADMIN",
      rateAllowed: false,
      service: { registerAgent },
    });

    const response = await api.registerAgent(
      jsonRequest("https://scar.test/api/scar/agents", {
        id: "agent-treasury",
        name: "Treasury Agent",
        role: "Moves approved company funds",
        status: "ACTIVE",
        permissions: ["USDC_TRANSFER"],
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(registerAgent).not.toHaveBeenCalled();
  });

  it("will not turn an ALLOW authorization into a human approval", async () => {
    const approveAction = vi.fn();
    const api = createApi({
      principal: { type: "HUMAN", subject: operatorId },
      role: "APPROVER",
      service: {
        getActionState: async () =>
          actionState({
            authorization: {
              id: "authorization-001",
              actionId: "action-001",
              decision: "ALLOW",
            },
          }),
        approveAction,
      },
    });

    const response = await api.approveAction(
      jsonRequest("https://scar.test/api/scar/actions/action-001/approvals", {
        authorizationId: "authorization-001",
      }),
      "action-001",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "REVIEW_AUTHORIZATION_REQUIRED" },
    });
    expect(approveAction).not.toHaveBeenCalled();
  });

  it("issues a scoped agent credential once without persisting its raw secret", async () => {
    const saveAgentCredential = vi.fn(async (_input: unknown) => undefined);
    const api = createApi({
      principal: { type: "HUMAN", subject: operatorId },
      role: "ADMIN",
      service: {
        getAgent: async () => ({
          id: "agent-treasury",
          name: "Treasury Agent",
          role: "Moves approved company funds",
          status: "ACTIVE",
          permissions: ["USDC_TRANSFER" as const],
        }),
      },
      saveAgentCredential,
      agentCredentialPepper: "p".repeat(32),
      createCredentialSecret: () => "s".repeat(43),
    });

    const response = await api.issueAgentCredential(
      jsonRequest("https://scar.test/api/scar/agents/agent-treasury/credentials", {
        allowedOperations: ["PROPOSE_ACTION", "READ_ACTION"],
        expiresAt: "2026-10-03T12:00:00.000Z",
      }),
      "agent-treasury",
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      credential: {
        id: "credential:http-001",
        agentId: "agent-treasury",
        allowedOperations: ["PROPOSE_ACTION", "READ_ACTION"],
      },
      token: `scar_agent_workspace-alpha.credential:http-001.${"s".repeat(43)}`,
    });
    expect(saveAgentCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "credential:http-001",
        workspaceId: "workspace-alpha",
        agentId: "agent-treasury",
        secretHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(saveAgentCredential.mock.calls[0][0]).not.toHaveProperty("token");
    expect(saveAgentCredential.mock.calls[0][0]).not.toHaveProperty("secret");
  });

  it("will not revoke a credential through a different agent resource", async () => {
    const revokeAgentCredential = vi.fn(async () => undefined);
    const api = createApi({
      principal: { type: "HUMAN", subject: operatorId },
      role: "ADMIN",
      findAgentCredential: async () => ({
        workspaceId: "workspace-alpha",
        id: "credential-001",
        agentId: "agent-treasury",
        secretHash: "a".repeat(64),
        allowedOperations: ["READ_ACTION" as const],
        status: "ACTIVE" as const,
        createdAt: timestamp,
        expiresAt: "2026-10-03T12:00:00.000Z",
      }),
      revokeAgentCredential,
    });

    const response = await api.revokeAgentCredential(
      jsonRequest("https://scar.test/api/scar/agents/agent-other/credentials/credential-001", {}),
      "agent-other",
      "credential-001",
    );
    expect(response.status).toBe(404);
    expect(revokeAgentCredential).not.toHaveBeenCalled();
  });

  it("does not accept an execution outcome before an execution exists", async () => {
    const recordOutcome = vi.fn();
    const api = createApi({
      principal: { type: "HUMAN", subject: operatorId },
      role: "SAFETY_OFFICER",
      service: {
        getActionState: async () => actionState({}),
        recordOutcome,
      },
    });

    const response = await api.recordOutcome(
      jsonRequest(
        "https://scar.test/api/scar/actions/action-001/outcomes",
        incidentRequestBody(),
        { "idempotency-key": "outcome-unique-001" },
      ),
      "action-001",
    );
    expect(response.status).toBe(409);
    expect(recordOutcome).not.toHaveBeenCalled();
  });

  it("retries an existing local incident without reconstructing caller evidence", async () => {
    const incident = {
      id: "incident:incident-unique-001",
      sourceAgentId: "agent-treasury",
      relatedActionId: "action-001",
      entityId: "supplier-alpha",
      actionType: "USDC_TRANSFER" as const,
      context: "Recipient verification failed.",
      outcome: "Transfer was stopped.",
      severity: "HIGH" as const,
      reason: "Recipient mismatch",
      mitigation: "Require human review.",
      evidence: [
        {
          kind: "SYSTEM_EVENT" as const,
          reference: "recipient-mismatch",
          observedAt: timestamp,
        },
      ],
      provenance: {
        source: "OPERATOR_REPORT" as const,
        recordedBy: operatorId,
        observedAt: timestamp,
      },
      createdAt: timestamp,
    };
    let incidentExists = false;
    const recordIncident = vi.fn(async () => {
      throw new ScarMemoryPersistenceError(incident, new Error("sidecar down"));
    });
    const retryIncident = vi.fn(async () => ({
      incident,
      memoryReceipt: {
        entityMemoryId: "memory-entity",
        incidentMemoryId: "memory-incident",
        safeguardMemoryId: "memory-safeguard",
        auditMemoryId: "memory-audit",
      },
    }));
    const api = createApi({
      principal: { type: "HUMAN", subject: operatorId },
      role: "SAFETY_OFFICER",
      service: {
        getActionState: async () => ({
          action: {
            id: "action-001",
            agentId: "agent-treasury",
            actionType: "USDC_TRANSFER",
            amountAtomic: "1000000",
            entityId: "supplier-alpha",
            recipient: "0x1111111111111111111111111111111111111111",
            chainId: 84532,
            proposedAt: timestamp,
          },
          authorization: null,
          approval: null,
          execution: null,
          incidents: incidentExists ? [incident] : [],
        }),
        recordIncident,
        retryIncident,
      },
    });
    const body = {
      entity: {
        name: "Supplier Alpha",
        externalIdentifier: "supplier-alpha-ext",
        type: "COUNTERPARTY",
      },
      context: "Recipient verification failed.",
      outcome: "Transfer was stopped.",
      severity: "HIGH",
      reason: "Recipient mismatch",
      mitigation: "Require human review.",
      evidence: [
        {
          kind: "SYSTEM_EVENT",
          reference: "recipient-mismatch",
          observedAt: timestamp,
        },
      ],
      safeguard: {
        requiredResponse: "REVIEW",
        reason: "Require human review.",
        scopeAgentIds: ["agent-treasury"],
      },
    };

    const first = await api.recordIncident(
      jsonRequest(
        "https://scar.test/api/scar/actions/action-001/incidents",
        body,
        { "idempotency-key": "incident-unique-001" },
      ),
      "action-001",
    );
    expect(first.status).toBe(503);
    await expect(first.json()).resolves.toMatchObject({
      error: { code: "MEMORY_PERSISTENCE_PENDING" },
      memoryShared: false,
      incidentId: incident.id,
    });

    incidentExists = true;
    const retry = await api.recordIncident(
      jsonRequest(
        "https://scar.test/api/scar/actions/action-001/incidents",
        { ...body, outcome: "This replacement must be ignored." },
        { "idempotency-key": "incident-unique-001" },
      ),
      "action-001",
    );
    expect(retry.status).toBe(200);
    expect(recordIncident).toHaveBeenCalledTimes(1);
    expect(retryIncident).toHaveBeenCalledWith(incident.id);
  });
});

function createApi(input: {
  principal:
    | { type: "HUMAN"; subject: string }
    | {
        type: "AGENT";
        subject: string;
        workspaceId: string;
        agentId: string;
        allowedOperations: Array<"PROPOSE_ACTION" | "READ_ACTION">;
      };
  role?: "ADMIN" | "OPERATOR" | "APPROVER" | "SAFETY_OFFICER";
  rateAllowed?: boolean;
  service?: Record<string, unknown>;
  saveAgentCredential?: (input: unknown) => Promise<void>;
  findAgentCredential?: (id: string) => Promise<{
    workspaceId: string;
    id: string;
    agentId: string;
    secretHash: string;
    allowedOperations: Array<"PROPOSE_ACTION" | "READ_ACTION">;
    status: "ACTIVE" | "REVOKED";
    createdAt: string;
    expiresAt: string;
  } | null>;
  revokeAgentCredential?: (id: string, revokedAt: string) => Promise<void>;
  agentCredentialPepper?: string;
  createCredentialSecret?: () => string;
  executionEnabled?: boolean;
}) {
  return createScarHttpApi({
    identityProvider: { authenticate: async () => input.principal },
    security: {
      findActiveWorkspaceMembership: async (_workspaceId, userId) => ({
        workspaceId: "workspace-alpha",
        userId,
        membership: "MEMBER" as const,
        status: "ACTIVE" as const,
        addedBy: operatorId,
        createdAt: timestamp,
      }),
      findActiveHumanRoles: async () => (input.role ? [input.role] : []),
      claimRateLimit: async () => input.rateAllowed ?? true,
      appendHttpAudit: async () => undefined,
      saveAgentCredential: input.saveAgentCredential ?? (async () => undefined),
      findWorkspaceAgentCredential: async (_workspaceId, credentialId) =>
        input.findAgentCredential?.(credentialId) ?? null,
      revokeWorkspaceAgentCredential: async (_workspaceId, credentialId, revokedAt) =>
        input.revokeAgentCredential?.(credentialId, revokedAt),
      findWorkspaceExecutionConfiguration: async () => ({
        status: input.executionEnabled === false ? "DISABLED" as const : "ENABLED" as const,
      }),
    },
    service: (input.service ?? {}) as ScarHttpApiDependencies["service"],
    workspaceId: "workspace-alpha",
    publicOrigin: "https://scar.test",
    agentCredentialPepper: input.agentCredentialPepper,
    now: () => timestamp,
    createId: () => "http-001",
    createCredentialSecret: input.createCredentialSecret,
    executionConfigurationAllows: () => input.executionEnabled !== false,
  });
}

function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://scar.test",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function actionState(input: {
  authorization?: { id: string; actionId: string; decision: "REVIEW" | "ALLOW" | "BLOCK" } | null;
  execution?: object | null;
  incidents?: unknown[];
}) {
  return {
    action: {
      id: "action-001",
      agentId: "agent-treasury",
      actionType: "USDC_TRANSFER" as const,
      amountAtomic: "1000000",
      entityId: "supplier-alpha",
      recipient: "0x1111111111111111111111111111111111111111",
      chainId: 84532,
      proposedAt: timestamp,
    },
    authorization: input.authorization ?? null,
    approval: null,
    execution: input.execution ?? null,
    incidents: input.incidents ?? [],
  };
}

function incidentRequestBody() {
  return {
    entity: {
      name: "Supplier Alpha",
      externalIdentifier: "supplier-alpha-ext",
      type: "COUNTERPARTY",
    },
    context: "Recipient verification failed.",
    outcome: "Transfer was stopped.",
    severity: "HIGH",
    reason: "Recipient mismatch",
    mitigation: "Require human review.",
    evidence: [
      {
        kind: "SYSTEM_EVENT",
        reference: "recipient-mismatch",
        observedAt: timestamp,
      },
    ],
    safeguard: {
      requiredResponse: "REVIEW",
      reason: "Require human review.",
      scopeAgentIds: ["agent-treasury"],
    },
  };
}
