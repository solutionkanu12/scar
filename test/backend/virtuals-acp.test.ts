import { describe, expect, it, vi } from "vitest";

import { DeterministicActionGate } from "@/server/scar/action-gate";
import type { FreshSessionMemoryReader } from "@/server/scar/fresh-session-retrieval";
import type { SibylRelevantEvidence } from "@/server/scar/sibyl-contract";
import { VolatileScarRepository } from "@/server/scar/volatile-repository";
import {
  VirtualsProcurementBridge,
  type AcpJobRef,
  type VirtualsAcpGateway,
  type VirtualsAgentRef,
  type VirtualsInteractionRecord,
} from "@/server/scar/virtuals-acp";

const now = "2026-09-10T17:00:00.000Z";
const settlementTx = "0xacpsettlement00000000000000000000000000000000000000000000000000ff";

const buyer: VirtualsAgentRef = {
  label: "Treasury Agent",
  role: "TREASURY_BUYER",
  walletAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  entityId: "acp-entity-treasury",
};
const seller: VirtualsAgentRef = {
  label: "Procurement Agent",
  role: "PROCUREMENT_SELLER",
  walletAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
  entityId: "acp-entity-procurement",
};

function fakeAcp(overrides: Partial<VirtualsAcpGateway> = {}): VirtualsAcpGateway {
  const negotiating: AcpJobRef = {
    jobId: "acp-job-4211",
    phase: "NEGOTIATION",
    clientAddress: buyer.walletAddress,
    providerAddress: seller.walletAddress,
    priceAtomic: "10000",
  };
  const completed: AcpJobRef = { ...negotiating, phase: "COMPLETED" };
  return {
    buyer,
    browseProviders: vi.fn().mockResolvedValue([seller]),
    initiateJob: vi.fn().mockResolvedValue(negotiating),
    payJob: vi
      .fn()
      .mockResolvedValue({ job: completed, transactionHash: settlementTx }),
    getJob: vi.fn().mockResolvedValue(completed),
    ...overrides,
  };
}

function cleanMemory(): FreshSessionMemoryReader {
  return {
    async findRelevantEvidence() {
      return {
        status: "AVAILABLE",
        lookupId: "lookup-clean",
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

function criticalMemory(): FreshSessionMemoryReader {
  const evidence: SibylRelevantEvidence = {
    status: "AVAILABLE",
    lookupId: "lookup-supplier-alpha",
    entity: {
      id: "supplier-alpha",
      name: "Supplier Alpha",
      externalIdentifier: "supplier-alpha.example",
      type: "COUNTERPARTY",
      createdAt: "2026-09-10T08:00:00.000Z",
    },
    incidents: [
      {
        id: "treasury-incident-001",
        sourceAgentId: "agent-treasury",
        relatedActionId: "treasury-action-001",
        entityId: "supplier-alpha",
        actionType: "USDC_TRANSFER",
        context: "Treasury Agent paid Supplier Alpha through a Virtuals job.",
        outcome: "The supplier failed to deliver after payment.",
        severity: "CRITICAL",
        reason: "Supplier Alpha did not fulfil the purchase.",
        mitigation: "Block future automated transfers pending investigation.",
        evidence: [
          {
            kind: "TRANSACTION",
            reference: "0xtreasury-transaction",
            observedAt: "2026-09-10T09:00:00.000Z",
          },
        ],
        provenance: {
          source: "OPERATOR_REPORT",
          recordedBy: "treasury-operator",
          observedAt: "2026-09-10T09:05:00.000Z",
        },
        createdAt: "2026-09-10T09:10:00.000Z",
      },
    ],
    safeguards: [],
  };
  return { async findRelevantEvidence() { return evidence; } };
}

async function harness(options: {
  memory: FreshSessionMemoryReader;
  acp?: VirtualsAcpGateway;
  amountAtomic?: string;
}) {
  const repository = new VolatileScarRepository();
  await repository.saveAgent({
    id: "agent-procurement",
    name: "Procurement Agent",
    role: "Pays suppliers and services",
    status: "ACTIVE",
    permissions: ["USDC_TRANSFER"],
  });
  await repository.saveAction({
    id: "action-procure-001",
    agentId: "agent-procurement",
    actionType: "USDC_TRANSFER",
    amountAtomic: options.amountAtomic ?? "10000",
    entityId: "supplier-alpha",
    recipient: "0x1111111111111111111111111111111111111111",
    chainId: 84532,
    proposedAt: now,
  });

  const gate = new DeterministicActionGate({
    repository,
    memory: options.memory,
    policy: {
      policyVersion: "scar-policy-v1",
      maxAmountAtomic: "1000000",
      reviewAmountAtomic: "500000",
      allowedChainIds: [84532],
    },
    now: () => now,
    createAuthorizationId: () => "authorization-procure-001",
  });
  const acp = options.acp ?? fakeAcp();
  const records: VirtualsInteractionRecord[] = [];
  const bridge = new VirtualsProcurementBridge({
    repository,
    gate,
    acp,
    constraints: { maxAmountAtomic: "1000000", allowedChainIds: [84532] },
    now: () => now,
    recordInteraction: (record) => {
      records.push(record);
    },
  });
  return { bridge, acp, records, repository };
}

const runInput = {
  actionId: "action-procure-001",
  serviceQuery: "supplier procurement settlement",
  requirement: { supplier: "Supplier Alpha", sku: "widget" },
  priceAtomic: "10000",
};

describe("VirtualsProcurementBridge", () => {
  it("settles the ACP job through the executor only after Scar returns ALLOW", async () => {
    const { bridge, acp, records } = await harness({ memory: cleanMemory() });

    const result = await bridge.runProcurement(runInput);

    expect(result.outcome).toBe("SETTLED");
    expect(result.decision.decision).toBe("ALLOW");
    expect(acp.payJob).toHaveBeenCalledTimes(1);
    expect(acp.payJob).toHaveBeenCalledWith("acp-job-4211");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      acpJobId: "acp-job-4211",
      buyer: { entityId: "acp-entity-treasury", role: "TREASURY_BUYER" },
      seller: { entityId: "acp-entity-procurement", role: "PROCUREMENT_SELLER" },
      phases: ["NEGOTIATION", "COMPLETED"],
      scarActionId: "action-procure-001",
      scarAuthorizationId: "authorization-procure-001",
      scarDecision: "ALLOW",
      settlementReference: settlementTx,
      outcome: "SETTLED",
    });
  });

  it("does not settle the ACP job when Scar returns BLOCK", async () => {
    const { bridge, acp, records } = await harness({ memory: criticalMemory() });

    const result = await bridge.runProcurement(runInput);

    expect(result.outcome).toBe("BLOCKED_BY_SCAR");
    expect(result.decision.decision).toBe("BLOCK");
    expect(result.decision.reasonCode).toBe("CRITICAL_INCIDENT");
    expect(acp.payJob).not.toHaveBeenCalled();
    expect(records[0]).toMatchObject({
      scarDecision: "BLOCK",
      settlementReference: null,
      outcome: "BLOCKED_BY_SCAR",
    });
  });

  it("holds the ACP job when Scar returns REVIEW without a scoped approval", async () => {
    const { bridge, acp, records } = await harness({
      memory: cleanMemory(),
      amountAtomic: "500001",
    });

    const result = await bridge.runProcurement({
      ...runInput,
      priceAtomic: "500001",
    });

    expect(result.outcome).toBe("REVIEW_REQUIRED");
    expect(result.decision.decision).toBe("REVIEW");
    expect(acp.payJob).not.toHaveBeenCalled();
    expect(records[0]?.outcome).toBe("REVIEW_REQUIRED");
  });

  it("settles a REVIEW job once an exact scoped approval exists", async () => {
    const { bridge, acp, repository } = await harness({
      memory: cleanMemory(),
      amountAtomic: "500001",
    });
    // The authorization id is deterministic, so the operator's scoped approval
    // can be recorded ahead of the settling run.
    await repository.saveApproval({
      id: "approval-procure-001",
      actionId: "action-procure-001",
      authorizationId: "authorization-procure-001",
      approvedBy: "operator-001",
      approvedAt: now,
    });

    const result = await bridge.runProcurement({
      ...runInput,
      priceAtomic: "500001",
      approvalId: "approval-procure-001",
    });

    expect(result.decision.decision).toBe("REVIEW");
    expect(result.outcome).toBe("SETTLED");
    expect(acp.payJob).toHaveBeenCalledTimes(1);
  });

  it("records NO_PROVIDER without authorizing or settling anything", async () => {
    const acp = fakeAcp({ browseProviders: vi.fn().mockResolvedValue([]) });
    const { bridge, records } = await harness({ memory: cleanMemory(), acp });

    const result = await bridge.runProcurement(runInput);

    expect(result.outcome).toBe("NO_PROVIDER");
    expect(acp.initiateJob).not.toHaveBeenCalled();
    expect(acp.payJob).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
  });
});
