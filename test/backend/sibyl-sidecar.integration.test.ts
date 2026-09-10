import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SibylMemoryClient } from "@/server/scar/sibyl-memory-client";

const timestamp = "2026-09-10T12:00:00.000Z";
const token = "scar-sibyl-integration-token-001";
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

  it("persists Scar evidence and audit history through a full service restart", async () => {
    if (!running || !workspace) throw new Error("sidecar did not start");
    const dbPath = path.join(workspace, "memory.db");
    const firstClient = clientFor(running.baseUrl);

    const receipt = await firstClient.persistScarMemory(validBundle());
    expect(receipt).toMatchObject({
      entityMemoryId: expect.any(String),
      incidentMemoryId: expect.any(String),
      safeguardMemoryId: expect.any(String),
      auditMemoryId: expect.any(String),
    });

    await running.stop();
    running = await startSidecar(dbPath);
    const restartedClient = clientFor(running.baseUrl);

    const evidence = await restartedClient.findRelevantEvidence(validAction());
    expect(evidence).toEqual({
      status: "AVAILABLE",
      lookupId: expect.any(String),
      entity: validBundle().entity,
      incidents: [validBundle().incident],
      safeguards: [validBundle().safeguard],
    });

    const history = await restartedClient.readAuditHistory({ limit: 20 });
    expect(history.events.map((entry) => entry.event.eventType)).toEqual([
      "MEMORY_LOOKUP",
      "SCAR_RECORDED",
    ]);
    expect(history.events[1]?.event).toMatchObject({
      id: "audit-001",
      incidentId: "scar-001",
      entityId: "supplier-alpha",
      safeguardId: "safeguard-001",
    });
  }, 30_000);

  it("refuses to rewrite an existing incident with different content", async () => {
    if (!running) throw new Error("sidecar did not start");
    const client = clientFor(running.baseUrl);
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

    expect(response.status).toBe(400);
    const evidence = await clientFor(running.baseUrl).findRelevantEvidence(
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
    const client = clientFor(running.baseUrl);
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
});

function clientFor(baseUrl: string) {
  return new SibylMemoryClient({ baseUrl, token, timeoutMs: 10_000 });
}

async function startSidecar(dbPath: string): Promise<RunningSidecar> {
  if (!python) throw new Error("SIBYL test Python is unavailable");
  const servicePath = path.resolve("services/sibyl/service.py");
  const process = spawn(python, [servicePath], {
    env: {
      ...processEnvWithoutSecrets(),
      SIBYL_DB_PATH: dbPath,
      SIBYL_TENANT_ID: "scar-integration-test",
      SIBYL_SIDECAR_HOST: "127.0.0.1",
      SIBYL_SIDECAR_PORT: "0",
      SIBYL_SIDECAR_TOKEN: token,
      SIBYL_MEMORY_TELEMETRY: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const ready = await waitForReady(process);
  return {
    baseUrl: `http://127.0.0.1:${ready.port}`,
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
  if (process.exitCode !== null) return;
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
