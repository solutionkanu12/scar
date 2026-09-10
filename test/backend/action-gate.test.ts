import { describe, expect, it } from "vitest";

import { DeterministicActionGate } from "../../server/scar/action-gate";
import { ExecutionBoundary } from "../../server/scar/execution-boundary";
import type { FreshSessionMemoryReader } from "../../server/scar/fresh-session-retrieval";
import type { ScarRepository } from "../../server/scar/repository";
import type { SibylRelevantEvidence } from "../../server/scar/sibyl-contract";
import { VolatileScarRepository } from "../../server/scar/volatile-repository";

const evaluatedAt = "2026-09-10T16:00:00.000Z";

function cleanMemory(lookupId = "lookup-clean"): FreshSessionMemoryReader {
  return {
    async findRelevantEvidence() {
      return {
        status: "AVAILABLE",
        lookupId,
        entity: {
          id: "supplier-alpha",
          name: "Supplier Alpha",
          externalIdentifier: "supplier-alpha.example",
          type: "COUNTERPARTY",
          createdAt: "2026-09-10T08:00:00.000Z",
        },
        incidents: [],
        safeguards: [],
      };
    },
  };
}

async function seedCleanAction(
  repository: VolatileScarRepository,
  options: {
    action?: Partial<{
      id: string;
      agentId: string;
      actionType: "USDC_TRANSFER";
      amountAtomic: string;
      entityId: string;
      recipient: string;
      chainId: number;
      proposedAt: string;
    }>;
    agent?: Partial<{
      id: string;
      name: string;
      role: string;
      status: "ACTIVE" | "SUSPENDED";
      permissions: "USDC_TRANSFER"[];
    }>;
  } = {},
) {
  await repository.saveAgent({
    id: "procurement-agent",
    name: "Procurement Agent",
    role: "Purchasing",
    status: "ACTIVE",
    permissions: ["USDC_TRANSFER"],
    ...options.agent,
  });
  return repository.saveAction({
    id: "action-001",
    agentId: "procurement-agent",
    actionType: "USDC_TRANSFER",
    amountAtomic: "400000",
    entityId: "supplier-alpha",
    recipient: "0x1111111111111111111111111111111111111111",
    chainId: 84532,
    proposedAt: "2026-09-10T15:59:00.000Z",
    ...options.action,
  });
}

function incidentMemory(
  options: {
    severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    requiredResponse?: "REVIEW" | "BLOCK";
    entityId?: string;
  } = {},
): FreshSessionMemoryReader {
  const entityId = options.entityId ?? "supplier-alpha";
  const incident = {
    id: "treasury-incident-001",
    sourceAgentId: "treasury-agent",
    relatedActionId: "treasury-action-001",
    entityId,
    actionType: "USDC_TRANSFER" as const,
    context: "Treasury Agent paid Supplier Alpha.",
    outcome: "The supplier failed to deliver.",
    severity: options.severity ?? "CRITICAL",
    reason: "Supplier Alpha did not fulfill the purchase.",
    mitigation: "Block future automated transfers pending investigation.",
    evidence: [
      {
        kind: "TRANSACTION" as const,
        reference: "0xtreasury-transaction",
        observedAt: "2026-09-10T09:00:00.000Z",
      },
    ],
    provenance: {
      source: "OPERATOR_REPORT" as const,
      recordedBy: "treasury-operator",
      observedAt: "2026-09-10T09:05:00.000Z",
    },
    createdAt: "2026-09-10T09:10:00.000Z",
  };
  const evidence: SibylRelevantEvidence = {
    status: "AVAILABLE",
    lookupId: "lookup-supplier-alpha",
    entity: {
      id: entityId,
      name: "Supplier Alpha",
      externalIdentifier: "supplier-alpha.example",
      type: "COUNTERPARTY",
      createdAt: "2026-09-10T08:00:00.000Z",
    },
    incidents: [incident],
    safeguards: options.requiredResponse
      ? [
          {
            id: `safeguard-${options.requiredResponse.toLowerCase()}`,
            sourceIncidentId: incident.id,
            trigger: { entityId, actionType: "USDC_TRANSFER" },
            scope: { agentIds: ["procurement-agent"] },
            requiredResponse: options.requiredResponse,
            reason: `${options.requiredResponse} transfers to Supplier Alpha.`,
            createdAt: "2026-09-10T09:11:00.000Z",
          },
        ]
      : [],
  };
  return { async findRelevantEvidence() { return evidence; } };
}

function createGate(
  repository: ScarRepository,
  memory: FreshSessionMemoryReader,
  authorizationId = "authorization-001",
) {
  return new DeterministicActionGate({
    repository,
    memory,
    policy: {
      policyVersion: "scar-policy-v1",
      maxAmountAtomic: "1000000",
      reviewAmountAtomic: "500000",
      allowedChainIds: [84532],
    },
    now: () => evaluatedAt,
    createAuthorizationId: () => authorizationId,
  });
}

describe("DeterministicActionGate", () => {
  it("allows a clean valid action and persists its deterministic audit record", async () => {
    const repository = new VolatileScarRepository();
    await seedCleanAction(repository);
    const gate = createGate(repository, cleanMemory());

    const result = await gate.authorize({ actionId: "action-001" });

    expect(result).toEqual({
      actionId: "action-001",
      authorizationId: "authorization-001",
      decision: "ALLOW",
      reasonCode: "NO_RELEVANT_RESTRICTION",
      rationale:
        "The action passed hard policy and validated memory contained no applicable restriction.",
      evidence: [
        {
          kind: "SYSTEM_EVENT",
          reference: "lookup-clean",
          observedAt: evaluatedAt,
        },
      ],
      provenance: {
        engine: "SCAR_DETERMINISTIC_POLICY",
        policyVersion: "scar-policy-v1",
        evaluatedAt,
      },
    });
    expect(await repository.findAuthorizationForAction("action-001")).toEqual({
      id: "authorization-001",
      actionId: "action-001",
      decision: "ALLOW",
      reasonCode: "NO_RELEVANT_RESTRICTION",
      rationale:
        "The action passed hard policy and validated memory contained no applicable restriction.",
      evidence: result.evidence,
      provenance: result.provenance,
    });
  });

  it("blocks malformed, unknown, and unauthorized actions before memory", async () => {
    const malformedRepository = new VolatileScarRepository();
    const malformed = await createGate(
      malformedRepository,
      cleanMemory(),
    ).authorize({ actionId: "action-001", decision: "ALLOW" });
    expect(malformed).toMatchObject({
      decision: "BLOCK",
      reasonCode: "INVALID_REQUEST",
      authorizationId: null,
    });

    const unknown = await createGate(
      new VolatileScarRepository(),
      cleanMemory(),
    ).authorize({ actionId: "missing-action" });
    expect(unknown).toMatchObject({
      decision: "BLOCK",
      reasonCode: "UNKNOWN_ACTION",
      authorizationId: null,
    });

    const unauthorizedRepository = new VolatileScarRepository();
    await seedCleanAction(unauthorizedRepository, {
      agent: { status: "SUSPENDED" },
    });
    const unauthorized = await createGate(
      unauthorizedRepository,
      cleanMemory(),
    ).authorize({ actionId: "action-001" });
    expect(unauthorized).toMatchObject({
      decision: "BLOCK",
      reasonCode: "UNAUTHORIZED_AGENT",
      authorizationId: "authorization-001",
    });

    class InvalidActionRepository extends VolatileScarRepository {
      override async findActionById() {
        return {
          id: "invalid-action",
          agentId: "procurement-agent",
          actionType: "USDC_TRANSFER",
          amountAtomic: "400000",
          entityId: "supplier-alpha",
          recipient: "not-an-address",
          chainId: 84532,
          proposedAt: evaluatedAt,
        } as never;
      }
    }
    const invalid = await createGate(
      new InvalidActionRepository(),
      cleanMemory(),
    ).authorize({ actionId: "invalid-action" });
    expect(invalid).toMatchObject({
      decision: "BLOCK",
      reasonCode: "INVALID_ACTION",
      authorizationId: null,
    });

    class MismatchedAgentRepository extends VolatileScarRepository {
      override async findAgentById() {
        return {
          id: "different-agent",
          name: "Different Agent",
          role: "Purchasing",
          status: "ACTIVE",
          permissions: ["USDC_TRANSFER"],
        } as never;
      }
    }
    const mismatchedRepository = new MismatchedAgentRepository();
    await mismatchedRepository.saveAction({
      ...(await seedCleanAction(new VolatileScarRepository())),
      id: "mismatched-agent-action",
    });
    const mismatched = await createGate(
      mismatchedRepository,
      cleanMemory(),
    ).authorize({ actionId: "mismatched-agent-action" });
    expect(mismatched).toMatchObject({
      decision: "BLOCK",
      reasonCode: "UNAUTHORIZED_AGENT",
    });
  });

  it.each([
    [{ amountAtomic: "1000001" }, "HARD_AMOUNT_CEILING"],
    [{ chainId: 1 }, "DISALLOWED_CHAIN"],
  ] as const)(
    "blocks hard-policy violation %# without consulting memory",
    async (action, reasonCode) => {
      const repository = new VolatileScarRepository();
      await seedCleanAction(repository, { action });
      const gate = createGate(repository, {
        async findRelevantEvidence() {
          throw new Error("Memory must not be consulted");
        },
      });

      const result = await gate.authorize({ actionId: "action-001" });

      expect(result).toMatchObject({ decision: "BLOCK", reasonCode });
    },
  );

  it("fails closed when required memory is unavailable or inconsistent", async () => {
    const unavailableRepository = new VolatileScarRepository();
    await seedCleanAction(unavailableRepository);
    const unavailable = await createGate(unavailableRepository, {
      async findRelevantEvidence() {
        throw new Error("Sibyl unavailable");
      },
    }).authorize({ actionId: "action-001" });
    expect(unavailable).toMatchObject({
      decision: "BLOCK",
      reasonCode: "MEMORY_UNAVAILABLE",
    });

    const inconsistentRepository = new VolatileScarRepository();
    await seedCleanAction(inconsistentRepository);
    const inconsistent = await createGate(
      inconsistentRepository,
      incidentMemory({ entityId: "supplier-beta" }),
    ).authorize({ actionId: "action-001" });
    expect(inconsistent).toMatchObject({
      decision: "BLOCK",
      reasonCode: "MEMORY_INCONSISTENT",
    });

    const decisionBearingRepository = new VolatileScarRepository();
    await seedCleanAction(decisionBearingRepository);
    const decisionBearing = await createGate(decisionBearingRepository, {
      async findRelevantEvidence(action) {
        const evidence = await cleanMemory().findRelevantEvidence(action);
        return { ...evidence, decision: "ALLOW" } as unknown as SibylRelevantEvidence;
      },
    }).authorize({ actionId: "action-001" });
    expect(decisionBearing).toMatchObject({
      decision: "BLOCK",
      reasonCode: "MEMORY_INCONSISTENT",
    });
  });

  it("turns an applicable BLOCK safeguard into a deterministic BLOCK", async () => {
    const repository = new VolatileScarRepository();
    await seedCleanAction(repository);

    const result = await createGate(
      repository,
      incidentMemory({ severity: "HIGH", requiredResponse: "BLOCK" }),
    ).authorize({ actionId: "action-001" });

    expect(result).toMatchObject({
      decision: "BLOCK",
      reasonCode: "APPLICABLE_BLOCK_SAFEGUARD",
      evidence: expect.arrayContaining([
        expect.objectContaining({ reference: "safeguard-block" }),
      ]),
    });
  });

  it("blocks the fresh Procurement action on the critical Supplier Alpha Scar", async () => {
    const repository = new VolatileScarRepository();
    await seedCleanAction(repository);

    const result = await createGate(
      repository,
      incidentMemory(),
    ).authorize({ actionId: "action-001" });

    expect(result).toMatchObject({
      decision: "BLOCK",
      reasonCode: "CRITICAL_INCIDENT",
      evidence: expect.arrayContaining([
        expect.objectContaining({ reference: "lookup-supplier-alpha" }),
        expect.objectContaining({ reference: "treasury-incident-001" }),
        expect.objectContaining({ reference: "0xtreasury-transaction" }),
      ]),
      provenance: {
        engine: "SCAR_DETERMINISTIC_POLICY",
        policyVersion: "scar-policy-v1",
        evaluatedAt,
      },
    });
  });

  it.each([
    [incidentMemory({ severity: "MEDIUM", requiredResponse: "REVIEW" }), "APPLICABLE_REVIEW_SAFEGUARD"],
    [cleanMemory("lookup-review-threshold"), "REVIEW_AMOUNT_THRESHOLD"],
  ] as const)(
    "returns REVIEW for review condition %#",
    async (memory, reasonCode) => {
      const repository = new VolatileScarRepository();
      await seedCleanAction(repository, {
        action:
          reasonCode === "REVIEW_AMOUNT_THRESHOLD"
            ? { amountAtomic: "500001" }
            : undefined,
      });

      const result = await createGate(repository, memory).authorize({
        actionId: "action-001",
      });

      expect(result).toMatchObject({ decision: "REVIEW", reasonCode });
      expect(await repository.findAuthorizationForAction("action-001"))
        .toMatchObject({
          decision: "REVIEW",
          reasonCode,
          provenance: {
            engine: "SCAR_DETERMINISTIC_POLICY",
            policyVersion: "scar-policy-v1",
            evaluatedAt,
          },
        });
    },
  );

  it("requires exact action-scoped approval for REVIEW and rejects replay", async () => {
    const repository = new VolatileScarRepository();
    await seedCleanAction(repository, { action: { amountAtomic: "500001" } });
    await createGate(repository, cleanMemory()).authorize({
      actionId: "action-001",
    });
    let adapterCalls = 0;
    const boundary = new ExecutionBoundary({
      repository,
      adapter: {
        async execute() {
          adapterCalls += 1;
          return { status: "SUCCEEDED", externalReference: "simulated-001" };
        },
      },
      constraints: { maxAmountAtomic: "1000000", allowedChainIds: [84532] },
      now: () => evaluatedAt,
      createExecutionId: () => "execution-001",
    });

    expect(await boundary.execute({ actionId: "action-001" })).toEqual({
      status: "REJECTED",
      reason: "APPROVAL_REQUIRED",
    });
    await repository.saveApproval({
      id: "wrong-approval",
      actionId: "different-action",
      authorizationId: "authorization-001",
      approvedBy: "operator-001",
      approvedAt: evaluatedAt,
    });
    expect(
      await boundary.execute({
        actionId: "action-001",
        approvalId: "wrong-approval",
      }),
    ).toEqual({ status: "REJECTED", reason: "APPROVAL_INVALID" });
    await repository.saveApproval({
      id: "exact-approval",
      actionId: "action-001",
      authorizationId: "authorization-001",
      approvedBy: "operator-001",
      approvedAt: evaluatedAt,
    });
    expect(
      await boundary.execute({
        actionId: "action-001",
        approvalId: "exact-approval",
      }),
    ).toMatchObject({ status: "SUCCEEDED" });
    expect(
      await boundary.execute({
        actionId: "action-001",
        approvalId: "exact-approval",
      }),
    ).toEqual({ status: "REJECTED", reason: "DUPLICATE_ACTION" });
    expect(adapterCalls).toBe(1);
  });

  it("never invokes the executor for a BLOCK decision", async () => {
    const repository = new VolatileScarRepository();
    await seedCleanAction(repository);
    await createGate(repository, incidentMemory()).authorize({
      actionId: "action-001",
    });
    let adapterCalls = 0;
    const boundary = new ExecutionBoundary({
      repository,
      adapter: {
        async execute() {
          adapterCalls += 1;
          return { status: "SUCCEEDED", externalReference: "must-not-run" };
        },
      },
      constraints: { maxAmountAtomic: "1000000", allowedChainIds: [84532] },
    });

    expect(await boundary.execute({ actionId: "action-001" })).toEqual({
      status: "REJECTED",
      reason: "BLOCKED",
    });
    expect(adapterCalls).toBe(0);
  });
});
