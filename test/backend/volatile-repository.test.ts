import { describe, expect, it } from "vitest";

import { VolatileScarRepository } from "@/server/scar/volatile-repository";

const timestamp = "2026-09-10T12:00:00.000Z";

describe("VolatileScarRepository", () => {
  it("stores validated agent and action records without claiming durability", async () => {
    const repository = new VolatileScarRepository();

    await repository.saveAgent(validAgent());
    await repository.saveAction(validAction());

    expect(repository.durability).toBe("VOLATILE_PROCESS");
    await expect(repository.findAgentById("agent-treasury")).resolves.toEqual(
      validAgent(),
    );
    await expect(repository.findActionById("action-001")).resolves.toEqual(
      validAction(),
    );
  });

  it("rejects invalid records at the adapter boundary", async () => {
    const repository = new VolatileScarRepository();

    await expect(
      repository.saveAction(validAction({ recipient: "not-an-address" })),
    ).rejects.toThrow();
    await expect(repository.findActionById("action-001")).resolves.toBeNull();
  });

  it("keeps incidents append-only and isolated from caller mutation", async () => {
    const repository = new VolatileScarRepository();
    const incident = validIncident();

    const saved = await repository.appendIncident(incident);
    incident.outcome = "rewritten outside the repository";
    saved.reason = "rewritten returned record";

    await expect(repository.appendIncident(validIncident())).rejects.toThrow(
      "Incident scar-001 already exists",
    );
    await expect(repository.findIncidentById("scar-001")).resolves.toMatchObject({
      outcome: "The transfer reached an unverified recipient.",
      reason: "Recipient mismatch",
    });
  });

  it("returns only incidents scoped to the requested entity and action type", async () => {
    const repository = new VolatileScarRepository();
    await repository.appendIncident(validIncident());
    await repository.appendIncident(
      validIncident({
        id: "scar-002",
        entityId: "supplier-beta",
        relatedActionId: "action-002",
      }),
    );

    const incidents = await repository.findIncidents({
      entityId: "supplier-alpha",
      actionType: "USDC_TRANSFER",
    });

    expect(incidents.map((incident) => incident.id)).toEqual(["scar-001"]);
  });

  it("stores authorization, approval, and execution as separate records", async () => {
    const repository = new VolatileScarRepository();
    await repository.saveAuthorization(validAuthorization());
    await repository.saveApproval(validApproval());

    const firstClaim = await repository.claimExecution({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "PENDING",
      startedAt: timestamp,
    });
    const replayClaim = await repository.claimExecution({
      id: "execution-002",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "PENDING",
      startedAt: timestamp,
    });

    expect(firstClaim?.status).toBe("PENDING");
    expect(replayClaim).toBeNull();
    await expect(
      repository.findAuthorizationForAction("action-001"),
    ).resolves.toMatchObject({ decision: "REVIEW" });
    await expect(
      repository.findApprovalById("approval-001"),
    ).resolves.toMatchObject({
      actionId: "action-001",
      authorizationId: "authorization-001",
    });

    await repository.completeExecution({
      id: "execution-001",
      actionId: "action-001",
      authorizationId: "authorization-001",
      status: "SUCCEEDED",
      startedAt: timestamp,
      completedAt: "2026-09-10T12:00:01.000Z",
      externalReference: "tx-reference-001",
    });

    await expect(
      repository.findExecutionForAction("action-001"),
    ).resolves.toMatchObject({
      status: "SUCCEEDED",
      externalReference: "tx-reference-001",
    });
    await expect(
      repository.findAuthorizationForAction("action-001"),
    ).resolves.toMatchObject({ decision: "REVIEW" });
  });
});

function validAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-treasury",
    name: "Treasury Agent",
    role: "Moves approved company funds",
    status: "ACTIVE",
    permissions: ["USDC_TRANSFER"],
    ...overrides,
  };
}

function validAction(overrides: Record<string, unknown> = {}) {
  return {
    id: "action-001",
    agentId: "agent-treasury",
    actionType: "USDC_TRANSFER",
    amountAtomic: "1000000",
    entityId: "supplier-alpha",
    recipient: "0x1111111111111111111111111111111111111111",
    chainId: 84532,
    proposedAt: timestamp,
    ...overrides,
  };
}

function validIncident(overrides: Record<string, unknown> = {}) {
  return {
    id: "scar-001",
    sourceAgentId: "agent-treasury",
    relatedActionId: "action-001",
    entityId: "supplier-alpha",
    actionType: "USDC_TRANSFER",
    context: "Supplier Alpha requested a transfer.",
    outcome: "The transfer reached an unverified recipient.",
    severity: "CRITICAL",
    reason: "Recipient mismatch",
    mitigation: "Block related transfers pending review.",
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
    createdAt: timestamp,
    ...overrides,
  };
}

function validAuthorization() {
  return {
    id: "authorization-001",
    actionId: "action-001",
    decision: "REVIEW",
    reasonCode: "RELEVANT_INCIDENT_REQUIRES_REVIEW",
    rationale: "A related incident requires explicit human approval.",
    evidence: [
      {
        kind: "SYSTEM_EVENT",
        reference: "scar-001",
        observedAt: timestamp,
      },
    ],
    provenance: {
      engine: "SCAR_DETERMINISTIC_POLICY",
      policyVersion: "policy-v1",
      evaluatedAt: timestamp,
    },
  };
}

function validApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: "approval-001",
    actionId: "action-001",
    authorizationId: "authorization-001",
    approvedBy: "operator-001",
    approvedAt: timestamp,
    ...overrides,
  };
}
