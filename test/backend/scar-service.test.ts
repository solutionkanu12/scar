import { describe, expect, it } from "vitest";

import { DeterministicActionGate } from "@/server/scar/action-gate";
import { createProductionScarService } from "@/server/scar/composition";
import { ExecutionBoundary } from "@/server/scar/execution-boundary";
import type {
  ExecutionAdapter,
  MemoryEvidenceLookup,
  ScarMemoryPersistence,
} from "@/server/scar/ports";
import {
  ScarMemoryPersistenceError,
  ScarService,
} from "@/server/scar/scar-service";
import {
  scarMemoryBundleSchema,
  type ScarMemoryBundle,
  type SibylRelevantEvidence,
} from "@/server/scar/sibyl-contract";
import { VolatileScarRepository } from "@/server/scar/volatile-repository";
import type { ProtectedAction } from "@/server/scar/domain";

const timestamp = "2026-10-01T12:00:00.000Z";

describe("ScarService", () => {
  it("persists, authorizes, and executes a clean action exactly once", async () => {
    const runtime = createRuntime();

    await runtime.service.registerAgent(agent());
    await runtime.service.proposeAction(action());

    const authorization = await runtime.service.evaluateAction("action-clean");
    const execution = await runtime.service.executeAction({
      actionId: "action-clean",
    });

    expect(authorization).toMatchObject({
      actionId: "action-clean",
      decision: "ALLOW",
    });
    expect(execution.status).toBe("SUCCEEDED");
    expect(runtime.adapter.executedActionIds).toEqual(["action-clean"]);
    await expect(runtime.repository.findExecutionForAction("action-clean")).resolves
      .toMatchObject({ status: "SUCCEEDED" });
  });

  it("requires an exact persisted approval before a REVIEW action executes", async () => {
    const runtime = createRuntime({
      evidence: safeguardedEvidence("REVIEW"),
      authorizationId: "authorization-review",
    });
    await runtime.service.registerAgent(agent());
    await runtime.service.proposeAction(action({ id: "action-review" }));

    await expect(runtime.service.evaluateAction("action-review")).resolves
      .toMatchObject({ decision: "REVIEW", authorizationId: "authorization-review" });
    await expect(
      runtime.service.executeAction({ actionId: "action-review" }),
    ).resolves.toEqual({ status: "REJECTED", reason: "APPROVAL_REQUIRED" });

    await runtime.service.approveAction({
      id: "approval-review",
      actionId: "action-review",
      authorizationId: "authorization-review",
      approvedBy: "operator-001",
      approvedAt: timestamp,
    });
    await expect(
      runtime.service.executeAction({
        actionId: "action-review",
        approvalId: "approval-review",
      }),
    ).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(runtime.adapter.executedActionIds).toEqual(["action-review"]);
  });

  it("never sends a blocked action to the adapter", async () => {
    const runtime = createRuntime({
      evidence: criticalEvidence(),
      authorizationId: "authorization-block",
    });
    await runtime.service.registerAgent(agent());
    await runtime.service.proposeAction(action({ id: "action-block" }));

    await expect(runtime.service.evaluateAction("action-block")).resolves
      .toMatchObject({ decision: "BLOCK", reasonCode: "CRITICAL_INCIDENT" });
    await expect(
      runtime.service.executeAction({ actionId: "action-block" }),
    ).resolves.toEqual({ status: "REJECTED", reason: "BLOCKED" });
    expect(runtime.adapter.executedActionIds).toEqual([]);
  });

  it("inherits a persisted incident through a fresh service runtime", async () => {
    const sharedMemory = new SharedMemory();
    const origin = createRuntime({
      memory: sharedMemory,
      authorizationId: "authorization-origin",
    });
    await origin.service.registerAgent(agent({ id: "agent-treasury" }));
    await origin.service.proposeAction(
      action({ id: "action-origin", agentId: "agent-treasury" }),
    );
    await origin.service.recordIncident(
      incidentBundle({
        incidentId: "incident-origin",
        actionId: "action-origin",
        sourceAgentId: "agent-treasury",
        safeguardId: "safeguard-origin",
        auditId: "audit-origin",
        scope: ["agent-procurement"],
      }),
    );

    const fresh = createRuntime({
      memory: sharedMemory,
      authorizationId: "authorization-fresh",
    });
    await fresh.service.registerAgent(agent());
    await fresh.service.proposeAction(action({ id: "action-fresh" }));

    await expect(fresh.service.evaluateAction("action-fresh")).resolves
      .toMatchObject({ decision: "BLOCK", reasonCode: "CRITICAL_INCIDENT" });
    expect(sharedMemory.lookupActionIds).toContain("action-fresh");
  });

  it("fails closed to BLOCK when Sibyl evidence is unavailable", async () => {
    const memory = new ControlledMemory(cleanEvidence());
    memory.lookupFailure = new Error("Sibyl unavailable");
    const runtime = createRuntime({ memory, authorizationId: "authorization-unavailable" });
    await runtime.service.registerAgent(agent());
    await runtime.service.proposeAction(action({ id: "action-unavailable" }));

    await expect(runtime.service.evaluateAction("action-unavailable")).resolves
      .toMatchObject({ decision: "BLOCK", reasonCode: "MEMORY_UNAVAILABLE" });
    await expect(
      runtime.service.executeAction({ actionId: "action-unavailable" }),
    ).resolves.toEqual({ status: "REJECTED", reason: "BLOCKED" });
    expect(runtime.adapter.executedActionIds).toEqual([]);
  });

  it("claims an action once so a replay cannot call the adapter twice", async () => {
    const runtime = createRuntime();
    await runtime.service.registerAgent(agent());
    await runtime.service.proposeAction(action({ id: "action-replay" }));
    await runtime.service.evaluateAction("action-replay");

    await expect(
      runtime.service.executeAction({ actionId: "action-replay" }),
    ).resolves.toMatchObject({ status: "SUCCEEDED" });
    await expect(
      runtime.service.executeAction({ actionId: "action-replay" }),
    ).resolves.toEqual({ status: "REJECTED", reason: "DUPLICATE_ACTION" });
    expect(runtime.adapter.executedActionIds).toEqual(["action-replay"]);
  });

  it("persists an unsafe outcome locally and shares a valid bundle with Sibyl", async () => {
    const memory = new ControlledMemory(cleanEvidence());
    const runtime = createRuntime({ memory });
    await runtime.service.registerAgent(agent());
    await runtime.service.proposeAction(action({ id: "action-unsafe" }));
    await runtime.service.evaluateAction("action-unsafe");
    await runtime.service.executeAction({ actionId: "action-unsafe" });
    const bundle = incidentBundle({
      incidentId: "incident-unsafe",
      actionId: "action-unsafe",
      sourceAgentId: "agent-procurement",
      safeguardId: "safeguard-unsafe",
      auditId: "audit-unsafe",
      scope: ["agent-procurement"],
    });

    const result = await runtime.service.recordOutcome(bundle);

    expect(result.incident).toEqual(bundle.incident);
    expect(scarMemoryBundleSchema.parse(memory.persistedBundles[0])).toEqual(bundle);
    expect(result).not.toHaveProperty("decision");
    await expect(runtime.repository.findIncidentById("incident-unsafe")).resolves
      .toEqual(bundle.incident);
  });

  it("keeps an incident append-only and signals failed Sibyl sharing for a safe retry", async () => {
    const memory = new ControlledMemory(cleanEvidence());
    memory.persistenceFailure = new Error("Sibyl unavailable");
    const runtime = createRuntime({ memory });
    await runtime.service.registerAgent(agent());
    await runtime.service.proposeAction(action({ id: "action-partial" }));
    const bundle = incidentBundle({
      incidentId: "incident-partial",
      actionId: "action-partial",
      sourceAgentId: "agent-procurement",
      safeguardId: "safeguard-partial",
      auditId: "audit-partial",
      scope: ["agent-procurement"],
    });

    await expect(runtime.service.recordIncident(bundle)).rejects.toMatchObject({
      name: "ScarMemoryPersistenceError",
      incident: bundle.incident,
    } satisfies Partial<ScarMemoryPersistenceError>);
    await expect(runtime.repository.findIncidentById("incident-partial")).resolves
      .toEqual(bundle.incident);

    memory.persistenceFailure = undefined;
    await expect(runtime.service.recordIncident(bundle)).resolves.toMatchObject({
      incident: bundle.incident,
    });
    expect(memory.persistedBundles).toEqual([bundle]);
    await expect(runtime.repository.findIncidents({})).resolves.toEqual([
      bundle.incident,
    ]);
  });

  it("rejects altered bundle evidence after a failed Sibyl write and reuses the original bundle", async () => {
    const memory = new ControlledMemory(cleanEvidence());
    memory.persistenceFailure = new Error("Sibyl unavailable");
    const runtime = createRuntime({ memory });
    await runtime.service.registerAgent(agent());
    await runtime.service.proposeAction(action({ id: "action-envelope" }));
    const bundle = incidentBundle({
      incidentId: "incident-envelope",
      actionId: "action-envelope",
      sourceAgentId: "agent-procurement",
      safeguardId: "safeguard-envelope",
      auditId: "audit-envelope",
      scope: ["agent-procurement"],
    });

    await expect(runtime.service.recordIncident(bundle)).rejects.toMatchObject({
      name: "ScarMemoryPersistenceError",
    });
    memory.persistenceFailure = undefined;
    const altered = structuredClone(bundle);
    altered.entity.name = "Supplier Alpha Renamed";

    await expect(runtime.service.recordIncident(altered)).rejects.toThrow();
    expect(memory.persistedBundles).toEqual([]);

    await runtime.service.recordIncident(bundle);
    expect(memory.persistedBundles).toEqual([bundle]);
  });

  it("retries Sibyl sharing from the durable immutable incident bundle", async () => {
    const memory = new ControlledMemory(cleanEvidence());
    memory.persistenceFailure = new Error("Sibyl unavailable");
    const runtime = createRuntime({ memory });
    await runtime.service.registerAgent(agent());
    await runtime.service.proposeAction(action({ id: "action-retry-only" }));
    const bundle = incidentBundle({
      incidentId: "incident-retry-only",
      actionId: "action-retry-only",
      sourceAgentId: "agent-procurement",
      safeguardId: "safeguard-retry-only",
      auditId: "audit-retry-only",
      scope: ["agent-procurement"],
    });

    await expect(runtime.service.recordIncident(bundle)).rejects.toMatchObject({
      name: "ScarMemoryPersistenceError",
    });
    memory.persistenceFailure = undefined;

    await expect(
      runtime.service.retryIncident("incident-retry-only"),
    ).resolves.toMatchObject({ incident: bundle.incident });
    expect(memory.persistedBundles).toEqual([bundle]);
  });

  it("returns only persisted lifecycle stages", async () => {
    const runtime = createRuntime({
      evidence: safeguardedEvidence("REVIEW"),
      authorizationId: "authorization-lifecycle",
    });
    const lifecycleAction = action({ id: "action-lifecycle" });
    await runtime.service.registerAgent(agent());
    await runtime.service.proposeAction(lifecycleAction);

    await expect(runtime.service.getActionState("action-lifecycle")).resolves
      .toEqual({
        action: lifecycleAction,
        authorization: null,
        approval: null,
        execution: null,
        incidents: [],
      });

    await runtime.service.evaluateAction("action-lifecycle");
    await runtime.service.approveAction({
      id: "approval-lifecycle",
      actionId: "action-lifecycle",
      authorizationId: "authorization-lifecycle",
      approvedBy: "operator-001",
      approvedAt: timestamp,
    });
    await runtime.service.executeAction({
      actionId: "action-lifecycle",
      approvalId: "approval-lifecycle",
    });
    await runtime.service.recordIncident(
      incidentBundle({
        incidentId: "incident-lifecycle",
        actionId: "action-lifecycle",
        sourceAgentId: "agent-procurement",
        safeguardId: "safeguard-lifecycle",
        auditId: "audit-lifecycle",
        scope: ["agent-procurement"],
      }),
    );

    await expect(runtime.service.getActionState("action-lifecycle")).resolves
      .toMatchObject({
        action: lifecycleAction,
        authorization: { id: "authorization-lifecycle", decision: "REVIEW" },
        approval: { id: "approval-lifecycle" },
        execution: { status: "SUCCEEDED" },
        incidents: [
          { id: "incident-lifecycle", relatedActionId: "action-lifecycle" },
        ],
      });
  });

  it("rejects approval for ALLOW decisions and approval replay", async () => {
    const allowed = createRuntime({ authorizationId: "authorization-allow" });
    await allowed.service.registerAgent(agent());
    await allowed.service.proposeAction(action({ id: "action-allow" }));
    await allowed.service.evaluateAction("action-allow");
    await expect(
      allowed.service.approveAction({
        id: "approval-allow",
        actionId: "action-allow",
        authorizationId: "authorization-allow",
        approvedBy: "operator-001",
        approvedAt: timestamp,
      }),
    ).rejects.toThrow();
    await expect(
      allowed.repository.findApprovalForAction("action-allow"),
    ).resolves.toBeNull();

    const review = createRuntime({
      evidence: safeguardedEvidence("REVIEW"),
      authorizationId: "authorization-duplicate",
    });
    await review.service.registerAgent(agent());
    await review.service.proposeAction(action({ id: "action-duplicate" }));
    await review.service.evaluateAction("action-duplicate");
    await expect(
      review.service.approveAction({
        id: "approval-mismatched",
        actionId: "action-duplicate",
        authorizationId: "authorization-other",
        approvedBy: "operator-001",
        approvedAt: timestamp,
      }),
    ).rejects.toThrow();
    await expect(
      review.repository.findApprovalForAction("action-duplicate"),
    ).resolves.toBeNull();
    await review.service.approveAction({
      id: "approval-first",
      actionId: "action-duplicate",
      authorizationId: "authorization-duplicate",
      approvedBy: "operator-001",
      approvedAt: timestamp,
    });

    await expect(
      review.service.approveAction({
        id: "approval-replay",
        actionId: "action-duplicate",
        authorizationId: "authorization-duplicate",
        approvedBy: "operator-001",
        approvedAt: timestamp,
      }),
    ).rejects.toThrow("already exists");
  });

  it("constructs the production service only from explicit runtime dependencies", () => {
    const adapter = new RecordingAdapter();

    const service = createProductionScarService({
      database: {
        prepare() {
          throw new Error("The database is not used during composition.");
        },
      } as unknown as D1Database,
      workspaceId: "workspace-alpha",
      sibyl: {
        baseUrl: "http://127.0.0.1:7331",
        token: "test-sidecar-token",
        tenantSigningKey: "test-sibyl-tenant-signing-key-001",
      },
      policy: {
        policyVersion: "scar-policy-v1",
        maxAmountAtomic: "1000000",
        reviewAmountAtomic: "500000",
        allowedChainIds: [84532],
      },
      execution: {
        adapter,
        constraints: { maxAmountAtomic: "1000000", allowedChainIds: [84532] },
      },
      now: () => timestamp,
    });

    expect(service).toBeInstanceOf(ScarService);
    expect(adapter.executedActionIds).toEqual([]);
  });
});

function createRuntime(
  options: {
    evidence?: SibylRelevantEvidence;
    memory?: ScarMemoryPersistence;
    authorizationId?: string;
  } = {},
) {
  const repository = new VolatileScarRepository();
  const memory = options.memory ?? new ControlledMemory(options.evidence ?? cleanEvidence());
  const adapter = new RecordingAdapter();
  const gate = new DeterministicActionGate({
    repository,
    memory,
    policy: {
      policyVersion: "scar-policy-v1",
      maxAmountAtomic: "1000000",
      reviewAmountAtomic: "500000",
      allowedChainIds: [84532],
    },
    now: () => timestamp,
    createAuthorizationId: () => options.authorizationId ?? "authorization-clean",
  });
  const boundary = new ExecutionBoundary({
    repository,
    adapter,
    constraints: { maxAmountAtomic: "1000000", allowedChainIds: [84532] },
    now: () => timestamp,
    createExecutionId: () => "execution-clean",
  });

  return {
    repository,
    adapter,
    service: new ScarService({ repository, gate, executionBoundary: boundary, memory }),
  };
}

class RecordingAdapter implements ExecutionAdapter {
  readonly executedActionIds: string[] = [];

  async execute(action: { id: string }) {
    this.executedActionIds.push(action.id);
    return { status: "SUCCEEDED" as const, externalReference: `tx-${action.id}` };
  }
}

class ControlledMemory implements ScarMemoryPersistence {
  readonly persistedBundles: ScarMemoryBundle[] = [];
  readonly lookupActionIds: string[] = [];
  lookupFailure: Error | undefined;
  persistenceFailure: Error | undefined;

  constructor(private readonly evidence: SibylRelevantEvidence) {}

  async findRelevantEvidence(action: ProtectedAction): Promise<SibylRelevantEvidence> {
    this.lookupActionIds.push(action.id);
    if (this.lookupFailure) throw this.lookupFailure;
    return structuredClone(this.evidence);
  }

  async persistScarMemory(bundle: ScarMemoryBundle) {
    if (this.persistenceFailure) throw this.persistenceFailure;
    this.persistedBundles.push(bundle);
    return {
      entityMemoryId: "memory-entity",
      incidentMemoryId: "memory-incident",
      safeguardMemoryId: "memory-safeguard",
      auditMemoryId: "memory-audit",
    };
  }

  async findRelevantIncidents(_action: ProtectedAction): Promise<MemoryEvidenceLookup> {
    return { status: "AVAILABLE" as const, lookupId: "lookup-clean", incidents: [] };
  }

  async readAuditHistory(_input: { limit: number }) {
    return { events: [] };
  }
}

class SharedMemory implements ScarMemoryPersistence {
  readonly persistedBundles: ScarMemoryBundle[] = [];
  readonly lookupActionIds: string[] = [];

  async persistScarMemory(bundle: ScarMemoryBundle) {
    const existing = this.persistedBundles.find(
      (stored) => stored.incident.id === bundle.incident.id,
    );
    if (existing && JSON.stringify(existing) !== JSON.stringify(bundle)) {
      throw new Error("Sibyl conflict");
    }
    if (!existing) this.persistedBundles.push(structuredClone(bundle));
    return {
      entityMemoryId: "memory-entity",
      incidentMemoryId: "memory-incident",
      safeguardMemoryId: "memory-safeguard",
      auditMemoryId: "memory-audit",
    };
  }

  async findRelevantEvidence(action: ProtectedAction): Promise<SibylRelevantEvidence> {
    this.lookupActionIds.push(action.id);
    const matching = this.persistedBundles.filter(
      (bundle) =>
        bundle.incident.entityId === action.entityId &&
        bundle.incident.actionType === action.actionType,
    );
    return {
      status: "AVAILABLE",
      lookupId: `lookup-${action.id}`,
      entity: matching[0]?.entity ?? null,
      incidents: matching.map((bundle) => bundle.incident),
      safeguards: matching
        .map((bundle) => bundle.safeguard)
        .filter((safeguard) => safeguard.scope.agentIds.includes(action.agentId)),
    };
  }

  async findRelevantIncidents(action: ProtectedAction): Promise<MemoryEvidenceLookup> {
    const evidence = await this.findRelevantEvidence(action);
    return {
      status: "AVAILABLE",
      lookupId: evidence.lookupId,
      incidents: evidence.incidents,
    };
  }

  async readAuditHistory(_input: { limit: number }) {
    return { events: [] };
  }
}

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-procurement",
    name: "Procurement Agent",
    role: "Purchasing",
    status: "ACTIVE" as const,
    permissions: ["USDC_TRANSFER" as const],
    ...overrides,
  };
}

function action(overrides: Record<string, unknown> = {}) {
  return {
    id: "action-clean",
    agentId: "agent-procurement",
    actionType: "USDC_TRANSFER" as const,
    amountAtomic: "400000",
    entityId: "supplier-alpha",
    recipient: "0x1111111111111111111111111111111111111111",
    chainId: 84532,
    proposedAt: timestamp,
    ...overrides,
  };
}

function cleanEvidence(): SibylRelevantEvidence {
  return {
    status: "AVAILABLE",
    lookupId: "lookup-clean",
    entity: {
      id: "supplier-alpha",
      name: "Supplier Alpha",
      externalIdentifier: "supplier-alpha.example",
      type: "COUNTERPARTY",
      createdAt: timestamp,
    },
    incidents: [],
    safeguards: [],
  };
}

function criticalEvidence(): SibylRelevantEvidence {
  const bundle = incidentBundle({
    incidentId: "incident-critical",
    actionId: "action-earlier",
    sourceAgentId: "agent-treasury",
    safeguardId: "safeguard-critical",
    auditId: "audit-critical",
    scope: ["agent-procurement"],
  });
  return {
    status: "AVAILABLE",
    lookupId: "lookup-critical",
    entity: bundle.entity,
    incidents: [bundle.incident],
    safeguards: [bundle.safeguard],
  };
}

function safeguardedEvidence(requiredResponse: "REVIEW" | "BLOCK") {
  const evidence = criticalEvidence();
  return {
    ...evidence,
    incidents: [{ ...evidence.incidents[0], severity: "HIGH" as const }],
    safeguards: [
      { ...evidence.safeguards[0], requiredResponse },
    ],
  } satisfies SibylRelevantEvidence;
}

function incidentBundle(input: {
  incidentId: string;
  actionId: string;
  sourceAgentId: string;
  safeguardId: string;
  auditId: string;
  scope: string[];
}): ScarMemoryBundle {
  return {
    entity: {
      id: "supplier-alpha",
      name: "Supplier Alpha",
      externalIdentifier: "supplier-alpha.example",
      type: "COUNTERPARTY",
      createdAt: timestamp,
    },
    incident: {
      id: input.incidentId,
      sourceAgentId: input.sourceAgentId,
      relatedActionId: input.actionId,
      entityId: "supplier-alpha",
      actionType: "USDC_TRANSFER",
      context: "Supplier Alpha received an unsafe transfer.",
      outcome: "The observed outcome was unsafe.",
      severity: "CRITICAL",
      reason: "The supplier caused a critical safety incident.",
      mitigation: "Block related transfers until an investigation completes.",
      evidence: [
        {
          kind: "OPERATOR_NOTE",
          reference: `note-${input.incidentId}`,
          observedAt: timestamp,
        },
      ],
      provenance: {
        source: "OPERATOR_REPORT",
        recordedBy: "operator-001",
        observedAt: timestamp,
      },
      createdAt: timestamp,
    },
    safeguard: {
      id: input.safeguardId,
      sourceIncidentId: input.incidentId,
      trigger: { entityId: "supplier-alpha", actionType: "USDC_TRANSFER" },
      scope: { agentIds: input.scope },
      requiredResponse: "BLOCK",
      reason: "Block related transfers after this critical incident.",
      createdAt: timestamp,
    },
    auditEvent: {
      id: input.auditId,
      eventType: "SCAR_RECORDED",
      actorId: "operator-001",
      incidentId: input.incidentId,
      entityId: "supplier-alpha",
      safeguardId: input.safeguardId,
      occurredAt: timestamp,
    },
  };
}
