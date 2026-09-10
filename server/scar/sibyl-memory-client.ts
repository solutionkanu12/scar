import { z } from "zod";

import {
  protectedActionSchema,
  type ProtectedAction,
} from "./domain";
import type { MemoryEvidenceLookup, ScarMemoryPersistence } from "./ports";
import {
  scarMemoryBundleSchema,
  sibylAuditHistoryResponseSchema,
  sibylPersistenceReceiptSchema,
  sibylRelevantEvidenceResponseSchema,
  type ScarMemoryBundle,
  type SibylAuditHistory,
  type SibylPersistenceReceipt,
  type SibylRelevantEvidence,
} from "./sibyl-contract";

const MAX_RESPONSE_BYTES = 1_048_576;

const relevantEvidenceRequestSchema = z
  .object({
    actionId: z.string().min(1).max(128),
    agentId: z.string().min(1).max(128),
    entityId: z.string().min(1).max(128),
    actionType: z.literal("USDC_TRANSFER"),
  })
  .strict();

interface SibylMemoryClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class SibylMemoryClient implements ScarMemoryPersistence {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: SibylMemoryClientOptions) {
    this.baseUrl = validatedBaseUrl(options.baseUrl);
    this.token = z.string().min(16).max(512).parse(options.token);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = z.number().int().positive().max(60_000).parse(
      options.timeoutMs ?? 5_000,
    );
  }

  async persistScarMemory(input: unknown): Promise<SibylPersistenceReceipt> {
    const bundle = scarMemoryBundleSchema.parse(input);
    const response = await this.post("/v1/scar-memory", bundle);
    return sibylPersistenceReceiptSchema.parse(response);
  }

  async findRelevantEvidence(
    action: ProtectedAction,
  ): Promise<SibylRelevantEvidence> {
    const parsedAction = protectedActionSchema.parse(action);
    const request = relevantEvidenceRequestSchema.parse({
      actionId: parsedAction.id,
      agentId: parsedAction.agentId,
      entityId: parsedAction.entityId,
      actionType: parsedAction.actionType,
    });
    const response = await this.post("/v1/relevant-evidence", request);
    return sibylRelevantEvidenceResponseSchema.parse(response);
  }

  async readAuditHistory(input: { limit: number }): Promise<SibylAuditHistory> {
    const request = z
      .object({ limit: z.number().int().positive().max(1_000) })
      .strict()
      .parse(input);
    const response = await this.post("/v1/audit-history", request);
    return sibylAuditHistoryResponseSchema.parse(response);
  }

  async findRelevantIncidents(
    action: ProtectedAction,
  ): Promise<MemoryEvidenceLookup> {
    try {
      const evidence = await this.findRelevantEvidence(action);
      return {
        status: "AVAILABLE",
        lookupId: evidence.lookupId,
        incidents: evidence.incidents,
      };
    } catch (error) {
      return {
        status: "UNAVAILABLE",
        reason:
          error instanceof z.ZodError
            ? "SIBYL_INVALID_RESPONSE"
            : "SIBYL_UNAVAILABLE",
      };
    }
  }

  private async post(path: string, body: ScarMemoryBundle | object) {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new SibylUnavailableError("Sibyl sidecar request failed", {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new SibylUnavailableError(
        `Sibyl sidecar returned HTTP ${response.status}`,
      );
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new SibylUnavailableError("Sibyl sidecar response exceeded limit");
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new SibylUnavailableError("Sibyl sidecar returned invalid JSON", {
        cause: error,
      });
    }
  }
}

export class SibylUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SibylUnavailableError";
  }
}

function validatedBaseUrl(value: string): string {
  const url = new URL(value);
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (url.protocol !== "https:" && !loopback.has(url.hostname)) {
    throw new Error("Sibyl sidecar requires HTTPS outside loopback");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Sibyl sidecar base URL contains unsupported components");
  }
  return url.toString().replace(/\/$/, "");
}
