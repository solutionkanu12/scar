import {
  DeterministicActionGate,
  type ActionGatePolicy,
} from "./action-gate";
import { D1ScarRepository } from "./d1-repository";
import { ExecutionBoundary } from "./execution-boundary";
import type { ExecutionAdapter } from "./ports";
import { ScarService } from "./scar-service";
import { SibylMemoryClient } from "./sibyl-memory-client";

export interface ProductionScarServiceDependencies {
  /** Durable SCAR operational database binding supplied by the runtime. */
  database: D1Database;
  /** Authenticated server-resolved tenant scope for this service instance. */
  workspaceId: string;
  /** Server-side Sibyl configuration supplied at runtime, never read on import. */
  sibyl: {
    baseUrl: string;
    token: string;
    /** HMAC key shared only with the tenant-aware Sibyl sidecar. */
    tenantSigningKey: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  };
  policy: ActionGatePolicy;
  /** The server configures the execution adapter and keeps any signer secret. */
  execution: {
    adapter: ExecutionAdapter;
    constraints: {
      maxAmountAtomic: string;
      allowedChainIds: number[];
    };
  };
  now?: () => string;
  createAuthorizationId?: () => string;
  createExecutionId?: () => string;
}

/**
 * Creates the production SCAR workflow from explicit runtime dependencies.
 * It deliberately does not read environment variables or construct adapters
 * from secrets at module import time.
 */
export function createProductionScarService(
  dependencies: ProductionScarServiceDependencies,
): ScarService {
  const repository = new D1ScarRepository(
    dependencies.database,
    dependencies.workspaceId,
  );
  const memory = new SibylMemoryClient({
    ...dependencies.sibyl,
    workspaceId: dependencies.workspaceId,
  });
  const gate = new DeterministicActionGate({
    repository,
    memory,
    policy: dependencies.policy,
    now: dependencies.now ?? (() => new Date().toISOString()),
    createAuthorizationId:
      dependencies.createAuthorizationId ?? (() => crypto.randomUUID()),
  });
  const executionBoundary = new ExecutionBoundary({
    repository,
    adapter: dependencies.execution.adapter,
    constraints: dependencies.execution.constraints,
    now: dependencies.now,
    createExecutionId: dependencies.createExecutionId,
  });
  return new ScarService({ repository, gate, executionBoundary, memory });
}
