import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DeterministicActionGate } from "@/server/scar/action-gate";
import { ExecutionBoundary } from "@/server/scar/execution-boundary";
import { retrieveFreshSessionEvidence } from "@/server/scar/fresh-session-retrieval";
import { createScarHttpApi } from "@/server/scar/http/api";
import {
  AgentCredentialIdentityProvider,
  type AuthenticatedPrincipal,
  type IdentityProvider,
} from "@/server/scar/http/identity";
import {
  agentCredentialRecordSchema,
  httpAuditRecordSchema,
  type AgentCredentialRecord,
  type HttpAuditRecord,
  type ScarRole,
  type WorkspaceMembershipRecord,
} from "@/server/scar/http/contracts";
import type { ExecutionAdapter } from "@/server/scar/ports";
import { ScarService } from "@/server/scar/scar-service";
import { SibylMemoryClient } from "@/server/scar/sibyl-memory-client";
import { VolatileScarRepository } from "@/server/scar/volatile-repository";

const timestamp = "2026-09-10T12:00:00.000Z";
const token = "scar-sibyl-integration-token-001";
const tenantSigningKey = "scar-sibyl-tenant-signing-key-001";
const workspaceId = "workspace:alpha";
const operatorId = "11111111-1111-4111-8111-111111111111";
const agentCredentialPepper = "p".repeat(32);
const python = resolveUvPython();
const integration = python ? describe : describe.skip;

integration("official Sibyl Memory sidecar", () => {
  let running: RunningSidecar | null = null;
  let workspace: string | null = null;

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), "scar-sibyl-test-"));
    running = await startSidecar(path.join(workspace, "memory.db"));
  });

  afterEach(async () => {
    await running?.stop();
    if (workspace) {
      await rm(workspace, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    }
    running = null;
    workspace = null;
  });

  it("retrieves Treasury evidence for Procurement through a completely fresh process", async () => {
    if (!running || !workspace) throw new Error("sidecar did not start");
    const dbPath = path.join(workspace, "memory.db");
    const sessionA = running;
    const treasuryClient = clientFor(sessionA.baseUrl, "workspace-alpha");

    const receipt = await treasuryClient.persistScarMemory(validBundle());
    expect(receipt).toMatchObject({
      entityMemoryId: expect.any(String),
      incidentMemoryId: expect.any(String),
      safeguardMemoryId: expect.any(String),
      auditMemoryId: expect.any(String),
    });

    await sessionA.stop();
    expect(sessionA.process.signalCode).not.toBeNull();
    running = await startSidecar(dbPath);
    expect(running.process).not.toBe(sessionA.process);
    const procurementClient = clientFor(running.baseUrl, "workspace-alpha");

    const evidence = await retrieveFreshSessionEvidence({
      action: validAction(),
      memory: procurementClient,
    });
    expect(evidence.status).toBe("AVAILABLE");
    if (evidence.status !== "AVAILABLE") {
      throw new Error("fresh Procurement session did not retrieve evidence");
    }
    expect(evidence.lookupId).toEqual(expect.any(String));
    expect(evidence.entity).toEqual({
      id: "supplier-alpha",
      name: "Supplier Alpha",
      externalIdentifier: "0x1111111111111111111111111111111111111111",
      type: "COUNTERPARTY",
      createdAt: timestamp,
    });
    expect(evidence.incidents).toHaveLength(1);
    expect(evidence.incidents[0]).toMatchObject({
      id: "scar-001",
      sourceAgentId: "agent-treasury",
      relatedActionId: "action-001",
      entityId: "supplier-alpha",
      severity: "CRITICAL",
      outcome: "The transfer reached an unverified recipient.",
      evidence: [
        {
          kind: "TRANSACTION",
          reference: "tx-reference-001",
          observedAt: timestamp,
        },
      ],
      provenance: {
        source: "OPERATOR_REPORT",
        recordedBy: "operator-001",
        observedAt: timestamp,
      },
    });
    expect(evidence.safeguards).toHaveLength(1);
    expect(evidence.safeguards[0]).toMatchObject({
      id: "safeguard-001",
      sourceIncidentId: "scar-001",
      trigger: {
        entityId: "supplier-alpha",
        actionType: "USDC_TRANSFER",
      },
      scope: {
        agentIds: ["agent-treasury", "agent-procurement"],
      },
      requiredResponse: "BLOCK",
      reason: "The recipient must be verified before another transfer.",
    });
    expect(evidence).not.toHaveProperty("decision");

    const freshSessionRepository = new VolatileScarRepository();
    await freshSessionRepository.saveAgent({
      id: "agent-procurement",
      name: "Procurement Agent",
      role: "Purchasing",
      status: "ACTIVE",
      permissions: ["USDC_TRANSFER"],
    });
    await freshSessionRepository.saveAction(validAction());
    const gate = new DeterministicActionGate({
      repository: freshSessionRepository,
      memory: procurementClient,
      policy: {
        policyVersion: "scar-policy-v1",
        maxAmountAtomic: "2000000",
        reviewAmountAtomic: "1500000",
        allowedChainIds: [84532],
      },
      now: () => timestamp,
      createAuthorizationId: () => "authorization-fresh-procurement",
    });

    const decision = await gate.authorize({ actionId: "action-002" });

    expect(decision).toMatchObject({
      actionId: "action-002",
      authorizationId: "authorization-fresh-procurement",
      decision: "BLOCK",
      reasonCode: "CRITICAL_INCIDENT",
      evidence: expect.arrayContaining([
        expect.objectContaining({ reference: "scar-001" }),
        expect.objectContaining({ reference: "tx-reference-001" }),
      ]),
      provenance: {
        engine: "SCAR_DETERMINISTIC_POLICY",
        policyVersion: "scar-policy-v1",
        evaluatedAt: timestamp,
      },
    });

    const history = await procurementClient.readAuditHistory({ limit: 20 });
    expect(history.events.map((entry) => entry.event.eventType)).toEqual([
      "MEMORY_LOOKUP",
      "MEMORY_LOOKUP",
      "SCAR_RECORDED",
    ]);
    expect(history.events[2]?.event).toMatchObject({
      id: "audit-001",
      incidentId: "scar-001",
      entityId: "supplier-alpha",
      safeguardId: "safeguard-001",
    });
  }, 30_000);

  it("changes a fresh authenticated Agent B decision from persisted Agent A memory", async () => {
    if (!running || !workspace) throw new Error("sidecar did not start");
    const dbPath = path.join(workspace, "memory.db");
    const security = new LifecycleSecurity();
    const treasuryId = "agent:treasury";
    const procurementId = "agent:procurement";
    const treasurySecret = "a".repeat(64);
    const procurementSecret = "b".repeat(64);

    const agentARepository = new VolatileScarRepository(workspaceId);
    const agentAApi = createLifecycleApi({
      memory: clientFor(running.baseUrl, workspaceId),
      repository: agentARepository,
      security,
      authorizationPrefix: "agent-a",
    });

    await expect(
      agentAApi.registerAgent(
        humanJsonRequest("/agents", agent(treasuryId, "Treasury")),
      ),
    ).resolves.toMatchObject({ status: 201 });
    await expect(
      agentAApi.registerAgent(
        humanJsonRequest("/agents", agent(procurementId, "Procurement")),
      ),
    ).resolves.toMatchObject({ status: 201 });

    const treasuryCredential = await issueCredential({
      api: agentAApi,
      agentId: treasuryId,
      secret: treasurySecret,
    });
    const procurementCredential = await issueCredential({
      api: agentAApi,
      agentId: procurementId,
      secret: procurementSecret,
    });
    expect(JSON.stringify(treasuryCredential.response)).not.toMatch(
      /secret|token|scar_agent_/i,
    );

    const treasuryBearer = bearerFor(treasuryCredential, treasurySecret);
    const treasuryProposal = await agentAApi.proposeAction(
      agentJsonRequest(treasuryBearer, "/actions", actionProposal(treasuryId), {
        "idempotency-key": "fresh-agent-treasury-action-001",
      }),
    );
    expect(treasuryProposal.status).toBe(201);
    const treasuryAction = await responseJson<{ action: { id: string } }>(
      treasuryProposal,
    );

    const treasuryEvaluation = await agentAApi.evaluateAction(
      agentRequest(treasuryBearer, `/actions/${treasuryAction.action.id}/evaluate`),
      treasuryAction.action.id,
    );
    expect(await responseJson(treasuryEvaluation)).toMatchObject({
      authorization: {
        decision: "ALLOW",
        reasonCode: "NO_RELEVANT_RESTRICTION",
      },
    });

    const incidentResponse = await agentAApi.recordIncident(
      humanJsonRequest(
        `/actions/${treasuryAction.action.id}/incidents`,
        incidentRequestBody(procurementId),
        { "idempotency-key": "fresh-agent-incident-001" },
      ),
      treasuryAction.action.id,
    );
    expect(incidentResponse.status).toBe(201);
    const incident = await responseJson<{
      incident: { id: string; sourceAgentId: string };
      memoryShared: boolean;
    }>(incidentResponse);
    expect(incident).toMatchObject({
      incident: {
        id: "incident:fresh-agent-incident-001",
        sourceAgentId: treasuryId,
      },
      memoryShared: true,
    });
    await expect(agentARepository.findIncidentMemoryBundle(incident.incident.id)).resolves
      .toMatchObject({
        incident: { id: incident.incident.id },
        safeguard: {
          id: "safeguard:fresh-agent-incident-001",
          scope: { agentIds: [procurementId] },
        },
      });

    const sidecarProcessForAgentA = running;
    await sidecarProcessForAgentA.stop();
    expect(sidecarProcessForAgentA.process.signalCode).not.toBeNull();
    running = await startSidecar(dbPath);
    expect(running.process).not.toBe(sidecarProcessForAgentA.process);

    const freshAgentBRepository = new VolatileScarRepository(workspaceId);
    const freshAgentBMemory = clientFor(running.baseUrl, workspaceId);
    const agentBApi = createLifecycleApi({
      memory: freshAgentBMemory,
      repository: freshAgentBRepository,
      security,
      authorizationPrefix: "agent-b",
    });
    await expect(
      agentBApi.registerAgent(
        humanJsonRequest("/agents", agent(procurementId, "Procurement")),
      ),
    ).resolves.toMatchObject({ status: 201 });
    await expect(freshAgentBRepository.findIncidentById(incident.incident.id)).resolves.toBeNull();

    const procurementBearer = bearerFor(procurementCredential, procurementSecret);
    const procurementProposal = await agentBApi.proposeAction(
      agentJsonRequest(
        procurementBearer,
        "/actions",
        actionProposal(procurementId),
        { "idempotency-key": "fresh-agent-procurement-action-001" },
      ),
    );
    expect(procurementProposal.status).toBe(201);
    const procurementAction = await responseJson<{ action: { id: string } }>(
      procurementProposal,
    );

    const procurementEvaluation = await agentBApi.evaluateAction(
      agentRequest(
        procurementBearer,
        `/actions/${procurementAction.action.id}/evaluate`,
      ),
      procurementAction.action.id,
    );
    expect(procurementEvaluation.status).toBe(201);
    expect(await responseJson(procurementEvaluation)).toMatchObject({
      authorization: {
        actionId: procurementAction.action.id,
        decision: "BLOCK",
        reasonCode: "APPLICABLE_BLOCK_SAFEGUARD",
        evidence: expect.arrayContaining([
          expect.objectContaining({ reference: "safeguard:fresh-agent-incident-001" }),
          expect.objectContaining({ reference: incident.incident.id }),
          expect.objectContaining({ reference: "tx:treasury-unsafe-transfer" }),
        ]),
      },
    });

    const storedAgentBState = await agentBApi.getActionState(
      agentRequest(procurementBearer, `/actions/${procurementAction.action.id}`),
      procurementAction.action.id,
    );
    expect(await responseJson(storedAgentBState)).toMatchObject({
      state: {
        authorization: {
          decision: "BLOCK",
          reasonCode: "APPLICABLE_BLOCK_SAFEGUARD",
        },
        incidents: [],
        execution: null,
      },
    });

    const executionAttempt = await agentBApi.executeAction(
      agentJsonRequest(procurementBearer, `/actions/${procurementAction.action.id}/execute`, {}),
      procurementAction.action.id,
    );
    expect(executionAttempt.status).toBe(403);
    await expect(executionAttempt.json()).resolves.toEqual({
      error: { code: "AGENT_OPERATION_FORBIDDEN" },
    });

    const sidecarAudit = await freshAgentBMemory.readAuditHistory({ limit: 20 });
    expect(sidecarAudit.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: expect.objectContaining({ eventType: "SCAR_RECORDED", incidentId: incident.incident.id }) }),
        expect.objectContaining({ event: expect.objectContaining({ eventType: "MEMORY_LOOKUP" }) }),
      ]),
    );
    expect(security.audits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ principalType: "AGENT", operation: "ACTION_PROPOSAL" }),
        expect.objectContaining({ principalType: "AGENT", operation: "ACTION_EVALUATION" }),
        expect.objectContaining({ principalType: "HUMAN", operation: "INCIDENT_RECORDING" }),
      ]),
    );

    await running.stop();
    const unavailableProposal = await agentBApi.proposeAction(
      agentJsonRequest(
        procurementBearer,
        "/actions",
        actionProposal(procurementId, "supplier:unavailable"),
        { "idempotency-key": "fresh-agent-unavailable-action-001" },
      ),
    );
    const unavailableAction = await responseJson<{ action: { id: string } }>(
      unavailableProposal,
    );
    const unavailableEvaluation = await agentBApi.evaluateAction(
      agentRequest(
        procurementBearer,
        `/actions/${unavailableAction.action.id}/evaluate`,
      ),
      unavailableAction.action.id,
    );
    expect(await responseJson(unavailableEvaluation)).toMatchObject({
      authorization: { decision: "BLOCK", reasonCode: "MEMORY_UNAVAILABLE" },
    });
  }, 30_000);

  it("refuses to rewrite an existing incident with different content", async () => {
    if (!running) throw new Error("sidecar did not start");
    const client = clientFor(running.baseUrl, "workspace-alpha");
    await client.persistScarMemory(validBundle());
    const changed = validBundle();
    changed.incident.outcome = "A rewritten outcome must not replace history.";

    await expect(client.persistScarMemory(changed)).rejects.toThrow(
      "Sibyl sidecar returned HTTP 409",
    );

    const evidence = await client.findRelevantEvidence(validAction());
    expect(evidence.incidents[0]?.outcome).toBe(
      "The transfer reached an unverified recipient.",
    );
  });

  it("rejects authorization fields at the authenticated persistence boundary", async () => {
    if (!running) throw new Error("sidecar did not start");
    const original = validBundle();
    const unauthorized = {
      ...original,
      incident: {
        ...original.incident,
        id: "scar-authorization-smuggle",
        decision: "ALLOW",
      },
      safeguard: {
        ...original.safeguard,
        id: "safeguard-authorization-smuggle",
        sourceIncidentId: "scar-authorization-smuggle",
      },
      auditEvent: {
        ...original.auditEvent,
        id: "audit-authorization-smuggle",
        incidentId: "scar-authorization-smuggle",
        safeguardId: "safeguard-authorization-smuggle",
      },
    };

    const response = await fetch(`${running.baseUrl}/v1/scar-memory`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(unauthorized),
    });

    expect(response.status).toBe(401);
    const evidence = await clientFor(
      running.baseUrl,
      "workspace-alpha",
    ).findRelevantEvidence(
      validAction(),
    );
    expect(evidence.incidents).toEqual([]);
  });

  it("rejects persistence requests without the sidecar credential", async () => {
    if (!running) throw new Error("sidecar did not start");

    const response = await fetch(`${running.baseUrl}/v1/scar-memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBundle()),
    });

    expect(response.status).toBe(401);
  });

  it("returns learned safeguards only to agents in their declared scope", async () => {
    if (!running) throw new Error("sidecar did not start");
    const client = clientFor(running.baseUrl, "workspace-alpha");
    const original = validBundle();
    const treasuryOnlyBundle = {
      ...original,
      safeguard: {
        ...original.safeguard,
        id: "safeguard-treasury-only",
        scope: { agentIds: ["agent-treasury"] },
      },
      auditEvent: {
        ...original.auditEvent,
        id: "audit-treasury-only",
        safeguardId: "safeguard-treasury-only",
      },
    };
    await client.persistScarMemory(original);
    await client.persistScarMemory(treasuryOnlyBundle);

    const procurementEvidence = await client.findRelevantEvidence(validAction());

    expect(procurementEvidence.incidents.map((incident) => incident.id)).toEqual([
      "scar-001",
    ]);
    expect(
      procurementEvidence.safeguards.map((safeguard) => safeguard.id),
    ).toEqual(["safeguard-001"]);
  });

  it("isolates tenants even when unrelated workspaces use identical SCAR identifiers", async () => {
    if (!running) throw new Error("sidecar did not start");
    const alpha = clientFor(running.baseUrl, "workspace-alpha");
    const beta = clientFor(running.baseUrl, "workspace-beta");

    await alpha.persistScarMemory(validBundle());

    await expect(beta.findRelevantEvidence(validAction())).resolves.toMatchObject({
      entity: null,
      incidents: [],
      safeguards: [],
    });

    // These IDs intentionally collide with Alpha's bundle. Isolation must be
    // provided by the signed tenant scope rather than callers changing IDs.
    await beta.persistScarMemory(validBundle());
    await expect(alpha.findRelevantEvidence(validAction())).resolves.toMatchObject({
      incidents: [expect.objectContaining({ id: "scar-001" })],
    });
    await expect(beta.findRelevantEvidence(validAction())).resolves.toMatchObject({
      incidents: [expect.objectContaining({ id: "scar-001" })],
    });

    const alphaHistory = await alpha.readAuditHistory({ limit: 20 });
    const betaHistory = await beta.readAuditHistory({ limit: 20 });
    expect(alphaHistory.events.filter((entry) => entry.event.id === "audit-001")).toHaveLength(1);
    expect(betaHistory.events.filter((entry) => entry.event.id === "audit-001")).toHaveLength(1);
  });
});

function clientFor(baseUrl: string, workspaceId: string) {
  return new SibylMemoryClient({
    baseUrl,
    token,
    workspaceId,
    tenantSigningKey,
    timeoutMs: 10_000,
  });
}

class LifecycleSecurity {
  readonly audits: HttpAuditRecord[] = [];
  private readonly credentials = new Map<string, AgentCredentialRecord>();
  private readonly agentIdentity = new AgentCredentialIdentityProvider({
    credentialReader: {
      findWorkspaceAgentCredential: (credentialWorkspaceId, credentialId) =>
        Promise.resolve(
          structuredClone(
            this.credentials.get(`${credentialWorkspaceId}:${credentialId}`) ?? null,
          ),
        ),
    },
    pepper: agentCredentialPepper,
    now: () => timestamp,
  });

  readonly identityProvider: IdentityProvider = {
    authenticate: (request) => this.authenticate(request),
  };

  async findActiveWorkspaceMembership(
    candidateWorkspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipRecord | null> {
    if (candidateWorkspaceId !== workspaceId || userId !== operatorId) return null;
    return {
      workspaceId,
      userId: operatorId,
      membership: "MEMBER",
      status: "ACTIVE",
      addedBy: operatorId,
      createdAt: timestamp,
    };
  }

  async findActiveHumanRoles(
    candidateWorkspaceId: string,
    userId: string,
  ): Promise<ScarRole[]> {
    return candidateWorkspaceId === workspaceId && userId === operatorId
      ? ["ADMIN", "SAFETY_OFFICER"]
      : [];
  }

  async claimRateLimit(): Promise<boolean> {
    return true;
  }

  async appendHttpAudit(input: unknown): Promise<void> {
    this.audits.push(httpAuditRecordSchema.parse(input));
  }

  async saveAgentCredential(input: unknown): Promise<AgentCredentialRecord> {
    const credential = agentCredentialRecordSchema.parse(input);
    this.credentials.set(
      `${credential.workspaceId}:${credential.id}`,
      structuredClone(credential),
    );
    return structuredClone(credential);
  }

  async findWorkspaceAgentCredential(
    candidateWorkspaceId: string,
    credentialId: string,
  ): Promise<AgentCredentialRecord | null> {
    return structuredClone(
      this.credentials.get(`${candidateWorkspaceId}:${credentialId}`) ?? null,
    );
  }

  async revokeWorkspaceAgentCredential(
    candidateWorkspaceId: string,
    credentialId: string,
    revokedAt: string,
  ): Promise<void> {
    const existing = await this.findWorkspaceAgentCredential(
      candidateWorkspaceId,
      credentialId,
    );
    if (!existing) return;
    this.credentials.set(`${candidateWorkspaceId}:${credentialId}`, {
      ...existing,
      status: "REVOKED",
      revokedAt,
    });
  }

  async findWorkspaceExecutionConfiguration() {
    return { status: "DISABLED" as const };
  }

  private authenticate(request: Request): Promise<AuthenticatedPrincipal> {
    if (request.headers.get("authorization") === "Bearer test-human") {
      return Promise.resolve({ type: "HUMAN", subject: operatorId });
    }
    return this.agentIdentity.authenticate(request);
  }
}

function createLifecycleApi(input: {
  memory: SibylMemoryClient;
  repository: VolatileScarRepository;
  security: LifecycleSecurity;
  authorizationPrefix: string;
}) {
  let authorizationSequence = 0;
  let executionSequence = 0;
  let httpSequence = 0;
  const executionAdapter: ExecutionAdapter = {
    execute: async () => ({ status: "FAILED", errorCode: "TEST_EXECUTION_DISABLED" }),
  };
  const service = new ScarService({
    repository: input.repository,
    memory: input.memory,
    gate: new DeterministicActionGate({
      repository: input.repository,
      memory: input.memory,
      policy: {
        policyVersion: "scar-policy-v1",
        maxAmountAtomic: "2000000",
        reviewAmountAtomic: "1500000",
        allowedChainIds: [84532],
      },
      now: () => timestamp,
      createAuthorizationId: () =>
        `authorization:${input.authorizationPrefix}:${++authorizationSequence}`,
    }),
    executionBoundary: new ExecutionBoundary({
      repository: input.repository,
      adapter: executionAdapter,
      constraints: { maxAmountAtomic: "2000000", allowedChainIds: [84532] },
      now: () => timestamp,
      createExecutionId: () => `execution:${input.authorizationPrefix}:${++executionSequence}`,
    }),
  });
  return createScarHttpApi({
    identityProvider: input.security.identityProvider,
    security: input.security,
    service,
    workspaceId,
    publicOrigin: "https://scar.test",
    agentCredentialPepper,
    now: () => timestamp,
    createId: () => `lifecycle:${input.authorizationPrefix}:${++httpSequence}`,
    executionConfigurationAllows: () => false,
  });
}

async function issueCredential(input: {
  api: ReturnType<typeof createScarHttpApi>;
  agentId: string;
  secret: string;
}) {
  const response = await input.api.issueAgentCredential(
    humanJsonRequest(`/agents/${input.agentId}/credentials`, {
      allowedOperations: ["PROPOSE_ACTION", "EVALUATE_ACTION", "READ_ACTION"],
      expiresAt: "2026-12-01T12:00:00.000Z",
      secret: input.secret,
    }),
    input.agentId,
  );
  expect(response.status).toBe(201);
  const body = await responseJson<{
    credential: { id: string; workspaceId: string; agentId: string };
  }>(response);
  return { response: body, credential: body.credential };
}

function bearerFor(
  issued: { credential: { id: string; workspaceId: string } },
  secret: string,
) {
  return `Bearer scar_agent_${issued.credential.workspaceId}.${issued.credential.id}.${secret}`;
}

function agent(id: string, name: string) {
  return {
    id,
    name: `${name} Agent`,
    role: `${name} operations`,
    status: "ACTIVE" as const,
    permissions: ["USDC_TRANSFER" as const],
  };
}

function actionProposal(agentId: string, entityId = "supplier:alpha") {
  return {
    agentId,
    actionType: "USDC_TRANSFER",
    amountAtomic: "1000000",
    entityId,
    recipient: "0x1111111111111111111111111111111111111111",
    chainId: 84532,
  };
}

function incidentRequestBody(scopeAgentId: string) {
  return {
    entity: {
      name: "Supplier Alpha",
      externalIdentifier: "supplier-alpha-external",
      type: "COUNTERPARTY",
    },
    context: "Treasury observed a recipient verification failure.",
    outcome: "The proposed transfer was unsafe.",
    severity: "HIGH",
    reason: "Recipient verification failed.",
    mitigation: "Block the scoped agent until recipient verification completes.",
    evidence: [
      {
        kind: "TRANSACTION",
        reference: "tx:treasury-unsafe-transfer",
        observedAt: timestamp,
      },
    ],
    safeguard: {
      requiredResponse: "BLOCK",
      reason: "This agent must not repeat the unsafe transfer.",
      scopeAgentIds: [scopeAgentId],
    },
  };
}

function humanJsonRequest(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`https://scar.test${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-human",
      origin: "https://scar.test",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function agentJsonRequest(
  bearer: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`https://scar.test${path}`, {
    method: "POST",
    headers: { authorization: bearer, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function agentRequest(bearer: string, path: string) {
  return new Request(`https://scar.test${path}`, {
    method: "POST",
    headers: { authorization: bearer },
  });
}

async function responseJson<T = unknown>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function startSidecar(dbPath: string): Promise<RunningSidecar> {
  if (!python) throw new Error("SIBYL test Python is unavailable");
  const servicePath = path.resolve("services/sibyl/service.py");
  const process = spawn(python, [servicePath], {
    env: {
      ...processEnvWithoutSecrets(),
      SIBYL_DB_PATH: dbPath,
      SIBYL_SIDECAR_HOST: "127.0.0.1",
      SIBYL_SIDECAR_PORT: "0",
      SIBYL_SIDECAR_TOKEN: token,
      SIBYL_TENANT_SIGNING_KEY: tenantSigningKey,
      SIBYL_MEMORY_TELEMETRY: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const ready = await waitForReady(process);
  return {
    baseUrl: `http://127.0.0.1:${ready.port}`,
    process,
    stop: () => stopSidecar(process),
  };
}

function waitForReady(
  process: ChildProcessWithoutNullStreams,
): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => {
      process.kill();
      reject(new Error(`Sibyl sidecar readiness timed out: ${stderr}`));
    }, 10_000);
    process.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    process.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Sibyl sidecar exited ${code}: ${stderr}`));
    });
    const lines = readline.createInterface({ input: process.stdout });
    lines.once("line", (line) => {
      clearTimeout(timeout);
      try {
        const parsed = JSON.parse(line) as { port?: unknown };
        if (typeof parsed.port !== "number") throw new Error("missing port");
        resolve({ port: parsed.port });
      } catch (error) {
        reject(new Error(`Invalid Sibyl readiness response: ${line}`, { cause: error }));
      } finally {
        lines.close();
      }
    });
  });
}

async function stopSidecar(
  process: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return;
  process.kill();
  await new Promise<void>((resolve) => process.once("exit", () => resolve()));
}

function resolveUvPython(): string | null {
  const environment = process.env.VIRTUAL_ENV;
  if (!environment) return null;
  return path.join(
    environment,
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
}

function processEnvWithoutSecrets(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.SIBYL_SIDECAR_TOKEN;
  return environment;
}

interface RunningSidecar {
  baseUrl: string;
  process: ChildProcessWithoutNullStreams;
  stop(): Promise<void>;
}

function validBundle() {
  return {
    entity: {
      id: "supplier-alpha",
      name: "Supplier Alpha",
      externalIdentifier: "0x1111111111111111111111111111111111111111",
      type: "COUNTERPARTY" as const,
      createdAt: timestamp,
    },
    incident: {
      id: "scar-001",
      sourceAgentId: "agent-treasury",
      relatedActionId: "action-001",
      entityId: "supplier-alpha",
      actionType: "USDC_TRANSFER" as const,
      context: "Supplier Alpha requested a transfer.",
      outcome: "The transfer reached an unverified recipient.",
      severity: "CRITICAL" as const,
      reason: "Recipient mismatch",
      mitigation: "Block related transfers pending review.",
      evidence: [
        {
          kind: "TRANSACTION" as const,
          reference: "tx-reference-001",
          observedAt: timestamp,
        },
      ],
      provenance: {
        source: "OPERATOR_REPORT" as const,
        recordedBy: "operator-001",
        observedAt: timestamp,
      },
      createdAt: timestamp,
    },
    safeguard: {
      id: "safeguard-001",
      sourceIncidentId: "scar-001",
      trigger: {
        entityId: "supplier-alpha",
        actionType: "USDC_TRANSFER" as const,
      },
      scope: {
        agentIds: ["agent-treasury", "agent-procurement"],
      },
      requiredResponse: "BLOCK" as const,
      reason: "The recipient must be verified before another transfer.",
      createdAt: timestamp,
    },
    auditEvent: {
      id: "audit-001",
      eventType: "SCAR_RECORDED" as const,
      actorId: "operator-001",
      incidentId: "scar-001",
      entityId: "supplier-alpha",
      safeguardId: "safeguard-001",
      occurredAt: timestamp,
    },
  };
}

function validAction() {
  return {
    id: "action-002",
    agentId: "agent-procurement",
    actionType: "USDC_TRANSFER" as const,
    amountAtomic: "1000000",
    entityId: "supplier-alpha",
    recipient: "0x1111111111111111111111111111111111111111",
    chainId: 84532,
    proposedAt: timestamp,
  };
}
