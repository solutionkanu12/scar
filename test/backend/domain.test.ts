import { describe, expect, it } from "vitest";

import {
  agentSchema,
  incidentSchema,
  protectedActionSchema,
} from "@/server/scar/domain";

const timestamp = "2026-09-10T12:00:00.000Z";

describe("Scar backend domain validation", () => {
  it("accepts a complete active agent with explicit action permissions", () => {
    const result = agentSchema.safeParse({
      id: "agent-treasury",
      name: "Treasury Agent",
      role: "Moves approved company funds",
      status: "ACTIVE",
      permissions: ["USDC_TRANSFER"],
    });

    expect(result.success).toBe(true);
  });

  it.each([
    ["a malformed recipient", "supplier-wallet"],
    ["a short recipient", "0x1234"],
  ])("rejects %s", (_label, recipient) => {
    const result = protectedActionSchema.safeParse(
      validAction({ recipient }),
    );

    expect(result.success).toBe(false);
  });

  it.each([
    ["zero", "0"],
    ["negative", "-1"],
    [
      "larger than uint256",
      "115792089237316195423570985008687907853269984665640564039457584007913129639936",
    ],
  ])("rejects a %s atomic amount", (_label, amountAtomic) => {
    const result = protectedActionSchema.safeParse(
      validAction({ amountAtomic }),
    );

    expect(result.success).toBe(false);
  });

  it("accepts a complete protected action at the validation boundary", () => {
    const result = protectedActionSchema.safeParse(validAction());

    expect(result.success).toBe(true);
  });

  it("rejects a chain ID that cannot be represented safely", () => {
    const result = protectedActionSchema.safeParse(
      validAction({ chainId: Number.MAX_SAFE_INTEGER + 1 }),
    );

    expect(result.success).toBe(false);
  });

  it("requires incident provenance and evidence references", () => {
    const result = incidentSchema.safeParse({
      id: "scar-001",
      sourceAgentId: "agent-treasury",
      relatedActionId: "action-001",
      entityId: "supplier-alpha",
      actionType: "USDC_TRANSFER",
      context: "Supplier Alpha requested a transfer.",
      outcome: "The recipient could not be verified.",
      severity: "CRITICAL",
      reason: "Recipient mismatch",
      mitigation: "Block related transfers pending review.",
      evidence: [],
      provenance: {
        source: "OPERATOR_REPORT",
        recordedBy: "operator-001",
        observedAt: timestamp,
      },
      createdAt: timestamp,
    });

    expect(result.success).toBe(false);
  });

  it("accepts an incident with traceable source evidence", () => {
    const result = incidentSchema.safeParse({
      id: "scar-001",
      sourceAgentId: "agent-treasury",
      relatedActionId: "action-001",
      entityId: "supplier-alpha",
      actionType: "USDC_TRANSFER",
      context: "Supplier Alpha requested a transfer.",
      outcome: "The recipient could not be verified.",
      severity: "CRITICAL",
      reason: "Recipient mismatch",
      mitigation: "Block related transfers pending review.",
      evidence: [
        {
          kind: "TRANSACTION",
          reference: "0x1234567890abcdef",
          observedAt: timestamp,
        },
      ],
      provenance: {
        source: "OPERATOR_REPORT",
        recordedBy: "operator-001",
        observedAt: timestamp,
      },
      createdAt: timestamp,
    });

    expect(result.success).toBe(true);
  });
});

function validAction(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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
