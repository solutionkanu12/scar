import { describe, expect, it, vi } from "vitest";

import {
  scarMemoryBundleSchema,
  sibylRelevantEvidenceResponseSchema,
} from "@/server/scar/sibyl-contract";
import { SibylMemoryClient } from "@/server/scar/sibyl-memory-client";

const timestamp = "2026-09-10T12:00:00.000Z";

describe("Sibyl memory contract", () => {
  it("accepts a traceable incident, entity, safeguard, and audit bundle", () => {
    expect(scarMemoryBundleSchema.safeParse(validBundle()).success).toBe(true);
  });

  it("rejects a safeguard that points at a different incident", () => {
    const bundle = validBundle();
    bundle.safeguard.sourceIncidentId = "scar-other";

    expect(scarMemoryBundleSchema.safeParse(bundle).success).toBe(false);
  });

  it("rejects authorization fields in a Sibyl evidence response", () => {
    const response = validRelevantResponse() as Record<string, unknown>;
    response.decision = "BLOCK";

    expect(sibylRelevantEvidenceResponseSchema.safeParse(response).success).toBe(
      false,
    );
  });
});

describe("SibylMemoryClient", () => {
  it("persists a validated Scar bundle through the authenticated sidecar", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        entityMemoryId: "mem-entity-001",
        incidentMemoryId: "mem-incident-001",
        safeguardMemoryId: "mem-safeguard-001",
        auditMemoryId: "mem-audit-001",
      }),
    );
    const client = new SibylMemoryClient({
      baseUrl: "http://127.0.0.1:7331",
      token: "test-sidecar-token",
      fetchImpl,
    });

    const result = await client.persistScarMemory(validBundle());

    expect(result).toEqual({
      entityMemoryId: "mem-entity-001",
      incidentMemoryId: "mem-incident-001",
      safeguardMemoryId: "mem-safeguard-001",
      auditMemoryId: "mem-audit-001",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:7331/v1/scar-memory",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-sidecar-token",
          "content-type": "application/json",
        }),
      }),
    );
  });

  it("returns validated incidents as evidence without an authorization result", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(validRelevantResponse()));
    const client = new SibylMemoryClient({
      baseUrl: "http://127.0.0.1:7331",
      token: "test-sidecar-token",
      fetchImpl,
    });

    const result = await client.findRelevantIncidents(validAction());

    expect(result).toEqual({
      status: "AVAILABLE",
      lookupId: "lookup-001",
      incidents: [validBundle().incident],
    });
    expect(result).not.toHaveProperty("decision");
  });

  it("fails closed when the sidecar cannot be reached", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("connection refused"));
    const client = new SibylMemoryClient({
      baseUrl: "http://127.0.0.1:7331",
      token: "test-sidecar-token",
      fetchImpl,
    });

    const result = await client.findRelevantIncidents(validAction());

    expect(result).toEqual({
      status: "UNAVAILABLE",
      reason: "SIBYL_UNAVAILABLE",
    });
  });

  it("fails closed when the sidecar returns malformed memory", async () => {
    const malformed = validRelevantResponse() as Record<string, unknown>;
    malformed.incidents = [{ id: "scar-001", decision: "ALLOW" }];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(malformed));
    const client = new SibylMemoryClient({
      baseUrl: "http://127.0.0.1:7331",
      token: "test-sidecar-token",
      fetchImpl,
    });

    const result = await client.findRelevantIncidents(validAction());

    expect(result).toEqual({
      status: "UNAVAILABLE",
      reason: "SIBYL_INVALID_RESPONSE",
    });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function validRelevantResponse() {
  const bundle = validBundle();
  return {
    status: "AVAILABLE",
    lookupId: "lookup-001",
    entity: bundle.entity,
    incidents: [bundle.incident],
    safeguards: [bundle.safeguard],
  };
}

function validBundle() {
  return {
    entity: {
      id: "supplier-alpha",
      name: "Supplier Alpha",
      externalIdentifier: "0x1111111111111111111111111111111111111111",
      type: "COUNTERPARTY",
      createdAt: timestamp,
    },
    incident: {
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
    },
    safeguard: {
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
      createdAt: timestamp,
    },
    auditEvent: {
      id: "audit-001",
      eventType: "SCAR_RECORDED",
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
