import { describe, expect, it } from "vitest";

import {
  retrieveFreshSessionEvidence,
  type FreshSessionMemoryReader,
} from "@/server/scar/fresh-session-retrieval";

const timestamp = "2026-09-10T12:00:00.000Z";

describe("fresh-session evidence retrieval", () => {
  it("returns complete organizational evidence without an authorization decision", async () => {
    const memory: FreshSessionMemoryReader = {
      findRelevantEvidence: async () => storedEvidence(),
    };

    const result = await retrieveFreshSessionEvidence({
      action: procurementAction(),
      memory,
    });

    expect(result).toEqual({
      status: "AVAILABLE",
      lookupId: "lookup-session-b",
      entity: {
        id: "supplier-alpha",
        name: "Supplier Alpha",
        externalIdentifier: "0x1111111111111111111111111111111111111111",
        type: "COUNTERPARTY",
        createdAt: timestamp,
      },
      incidents: [
        {
          id: "scar-treasury-alpha",
          sourceAgentId: "agent-treasury",
          relatedActionId: "action-treasury-alpha",
          entityId: "supplier-alpha",
          actionType: "USDC_TRANSFER",
          context: "Supplier Alpha requested a Treasury transfer.",
          outcome: "The transfer reached an unverified recipient.",
          severity: "CRITICAL",
          reason: "Recipient mismatch",
          mitigation: "Require recipient verification before another transfer.",
          evidence: [
            {
              kind: "TRANSACTION",
              reference: "tx-treasury-alpha",
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
      ],
      safeguards: [
        {
          id: "safeguard-treasury-alpha",
          sourceIncidentId: "scar-treasury-alpha",
          trigger: {
            entityId: "supplier-alpha",
            actionType: "USDC_TRANSFER",
          },
          scope: {
            agentIds: ["agent-treasury", "agent-procurement"],
          },
          requiredResponse: "BLOCK",
          reason: "Verify the recipient before another Supplier Alpha transfer.",
          createdAt: timestamp,
        },
      ],
    });
    expect(result).not.toHaveProperty("decision");
  });

  it.each([
    [
      "entity does not match the requested entity",
      (evidence: ReturnType<typeof storedEvidence>) => {
        if (evidence.entity) evidence.entity.id = "supplier-beta";
      },
    ],
    [
      "incident does not match the requested entity",
      (evidence: ReturnType<typeof storedEvidence>) => {
        evidence.incidents[0]!.entityId = "supplier-beta";
      },
    ],
    [
      "safeguard does not reference a retrieved incident",
      (evidence: ReturnType<typeof storedEvidence>) => {
        evidence.safeguards[0]!.sourceIncidentId = "scar-unrelated";
      },
    ],
    [
      "requesting agent is outside the safeguard scope",
      (evidence: ReturnType<typeof storedEvidence>) => {
        evidence.safeguards[0]!.scope.agentIds = ["agent-treasury"];
      },
    ],
  ])("fails closed when %s", async (_name, mutate) => {
    const evidence = storedEvidence();
    mutate(evidence);
    const memory: FreshSessionMemoryReader = {
      findRelevantEvidence: async () => evidence,
    };

    const result = await retrieveFreshSessionEvidence({
      action: procurementAction(),
      memory,
    });

    expect(result).toEqual({
      status: "UNAVAILABLE",
      reason: "SIBYL_INVALID_RESPONSE",
    });
  });

  it("fails closed when memory returns an invalid evidence shape", async () => {
    const invalidEvidence = {
      ...storedEvidence(),
      decision: "BLOCK",
    };
    const memory: FreshSessionMemoryReader = {
      findRelevantEvidence: async () => invalidEvidence,
    };

    const result = await retrieveFreshSessionEvidence({
      action: procurementAction(),
      memory,
    });

    expect(result).toEqual({
      status: "UNAVAILABLE",
      reason: "SIBYL_INVALID_RESPONSE",
    });
  });

  it("fails closed when organizational memory is unavailable", async () => {
    const memory: FreshSessionMemoryReader = {
      findRelevantEvidence: async () => {
        throw new Error("sidecar unavailable");
      },
    };

    const result = await retrieveFreshSessionEvidence({
      action: procurementAction(),
      memory,
    });

    expect(result).toEqual({
      status: "UNAVAILABLE",
      reason: "SIBYL_UNAVAILABLE",
    });
  });
});

function storedEvidence() {
  return {
    status: "AVAILABLE" as const,
    lookupId: "lookup-session-b",
    entity: {
      id: "supplier-alpha",
      name: "Supplier Alpha",
      externalIdentifier: "0x1111111111111111111111111111111111111111",
      type: "COUNTERPARTY" as const,
      createdAt: timestamp,
    },
    incidents: [
      {
        id: "scar-treasury-alpha",
        sourceAgentId: "agent-treasury",
        relatedActionId: "action-treasury-alpha",
        entityId: "supplier-alpha",
        actionType: "USDC_TRANSFER" as const,
        context: "Supplier Alpha requested a Treasury transfer.",
        outcome: "The transfer reached an unverified recipient.",
        severity: "CRITICAL" as const,
        reason: "Recipient mismatch",
        mitigation: "Require recipient verification before another transfer.",
        evidence: [
          {
            kind: "TRANSACTION" as const,
            reference: "tx-treasury-alpha",
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
    ],
    safeguards: [
      {
        id: "safeguard-treasury-alpha",
        sourceIncidentId: "scar-treasury-alpha",
        trigger: {
          entityId: "supplier-alpha",
          actionType: "USDC_TRANSFER" as const,
        },
        scope: {
          agentIds: ["agent-treasury", "agent-procurement"],
        },
        requiredResponse: "BLOCK" as const,
        reason: "Verify the recipient before another Supplier Alpha transfer.",
        createdAt: timestamp,
      },
    ],
  };
}

function procurementAction() {
  return {
    id: "action-procurement-alpha",
    agentId: "agent-procurement",
    actionType: "USDC_TRANSFER" as const,
    amountAtomic: "1000000",
    entityId: "supplier-alpha",
    recipient: "0x1111111111111111111111111111111111111111",
    chainId: 84532,
    proposedAt: timestamp,
  };
}
