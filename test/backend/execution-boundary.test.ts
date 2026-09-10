import { describe, expect, it, vi } from "vitest";

import { ExecutionBoundary } from "@/server/scar/execution-boundary";
import type { ExecutionAdapter } from "@/server/scar/ports";
import { VolatileScarRepository } from "@/server/scar/volatile-repository";

const timestamp = "2026-09-10T12:00:00.000Z";
const completedAt = "2026-09-10T12:00:01.000Z";

describe("ExecutionBoundary", () => {
  it("executes an allowed action from server-side authorization and stores the outcome separately", async () => {
    const { boundary, execute, repository } = await configuredBoundary({
      decision: "ALLOW",
    });

    const result = await boundary.execute({ actionId: "action-001" });

    expect(result).toMatchObject({
      status: "SUCCEEDED",
      execution: {
        actionId: "action-001",
        authorizationId: "authorization-001",
        externalReference: "tx-reference-001",
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(validAction());
    await expect(
      repository.findAuthorizationForAction("action-001"),
    ).resolves.toMatchObject({ decision: "ALLOW" });
    await expect(
      repository.findExecutionForAction("action-001"),
    ).resolves.toMatchObject({ status: "SUCCEEDED" });
  });

  it("rejects caller-supplied decision fields instead of trusting model or browser output", async () => {
    const { boundary, execute } = await configuredBoundary({ decision: "ALLOW" });

    const result = await boundary.execute({
      actionId: "action-001",
      decision: "ALLOW",
    });

    expect(result).toEqual({ status: "REJECTED", reason: "INVALID_REQUEST" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects malformed action identifiers at the request boundary", async () => {
    const { boundary, execute } = await configuredBoundary({ decision: "ALLOW" });

    const result = await boundary.execute({ actionId: "../action-001" });

    expect(result).toEqual({ status: "REJECTED", reason: "INVALID_REQUEST" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed when no server-side authorization exists", async () => {
    const { boundary, execute } = await configuredBoundary({
      decision: null,
    });

    const result = await boundary.execute({ actionId: "action-001" });

    expect(result).toEqual({
      status: "REJECTED",
      reason: "AUTHORIZATION_MISSING",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed when authorization storage is unavailable", async () => {
    const { boundary, execute, repository } = await configuredBoundary({
      decision: "ALLOW",
    });
    vi.spyOn(repository, "findAuthorizationForAction").mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    const result = await boundary.execute({ actionId: "action-001" });

    expect(result).toEqual({
      status: "REJECTED",
      reason: "DEPENDENCY_UNAVAILABLE",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a corrupt authorization record instead of treating it as permission", async () => {
    const { boundary, execute, repository } = await configuredBoundary({
      decision: "ALLOW",
    });
    vi.spyOn(repository, "findAuthorizationForAction").mockResolvedValueOnce({
      ...validAuthorization(),
      evidence: [],
    } as never);

    const result = await boundary.execute({ actionId: "action-001" });

    expect(result).toEqual({
      status: "REJECTED",
      reason: "AUTHORIZATION_INVALID",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not invoke the adapter for a BLOCK decision", async () => {
    const { boundary, execute } = await configuredBoundary({
      decision: "BLOCK",
    });

    const result = await boundary.execute({ actionId: "action-001" });

    expect(result).toEqual({ status: "REJECTED", reason: "BLOCKED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not execute REVIEW without explicit approval", async () => {
    const { boundary, execute } = await configuredBoundary({
      decision: "REVIEW",
    });

    const result = await boundary.execute({ actionId: "action-001" });

    expect(result).toEqual({
      status: "REJECTED",
      reason: "APPROVAL_REQUIRED",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects approval scoped to a different action", async () => {
    const { boundary, execute, repository } = await configuredBoundary({
      decision: "REVIEW",
    });
    await repository.saveApproval(
      validApproval({ actionId: "action-other" }),
    );

    const result = await boundary.execute({
      actionId: "action-001",
      approvalId: "approval-001",
    });

    expect(result).toEqual({
      status: "REJECTED",
      reason: "APPROVAL_INVALID",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes REVIEW only with approval scoped to the exact action and decision", async () => {
    const { boundary, execute, repository } = await configuredBoundary({
      decision: "REVIEW",
    });
    await repository.saveApproval(validApproval());

    const result = await boundary.execute({
      actionId: "action-001",
      approvalId: "approval-001",
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["unknown", null],
    ["suspended", validAgent({ status: "SUSPENDED" })],
    ["unpermitted", validAgent({ permissions: [] })],
  ])("rejects an %s agent", async (_label, agent) => {
    const { boundary, execute } = await configuredBoundary({
      decision: "ALLOW",
      agent,
    });

    const result = await boundary.execute({ actionId: "action-001" });

    expect(result).toEqual({
      status: "REJECTED",
      reason: "UNAUTHORIZED_AGENT",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a corrupt persisted action before the adapter boundary", async () => {
    const { boundary, execute, repository } = await configuredBoundary({
      decision: "ALLOW",
    });
    vi.spyOn(repository, "findActionById").mockResolvedValueOnce({
      ...validAction(),
      recipient: "corrupt-address",
    } as never);

    const result = await boundary.execute({ actionId: "action-001" });

    expect(result).toEqual({ status: "REJECTED", reason: "INVALID_ACTION" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("enforces hard amount and chain constraints even when authorization says ALLOW", async () => {
    const { boundary, execute } = await configuredBoundary({
      decision: "ALLOW",
      action: validAction({ amountAtomic: "1000001" }),
      maxAmountAtomic: "1000000",
    });

    const amountResult = await boundary.execute({ actionId: "action-001" });

    expect(amountResult).toEqual({
      status: "REJECTED",
      reason: "POLICY_LIMIT_EXCEEDED",
    });
    expect(execute).not.toHaveBeenCalled();

    const otherChain = await configuredBoundary({
      decision: "ALLOW",
      action: validAction({ chainId: 1 }),
    });
    const chainResult = await otherChain.boundary.execute({
      actionId: "action-001",
    });

    expect(chainResult).toEqual({
      status: "REJECTED",
      reason: "CHAIN_NOT_ALLOWED",
    });
    expect(otherChain.execute).not.toHaveBeenCalled();
  });

  it("claims the action once so a replay cannot invoke the adapter twice", async () => {
    const { boundary, execute } = await configuredBoundary({ decision: "ALLOW" });

    const first = await boundary.execute({ actionId: "action-001" });
    const replay = await boundary.execute({ actionId: "action-001" });

    expect(first.status).toBe("SUCCEEDED");
    expect(replay).toEqual({
      status: "REJECTED",
      reason: "DUPLICATE_ACTION",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("records adapter failure without changing the prior authorization", async () => {
    const { boundary, repository } = await configuredBoundary({
      decision: "ALLOW",
      adapterResult: { status: "FAILED", errorCode: "RPC_UNAVAILABLE" },
    });

    const result = await boundary.execute({ actionId: "action-001" });

    expect(result).toMatchObject({
      status: "FAILED",
      execution: { status: "FAILED", errorCode: "RPC_UNAVAILABLE" },
    });
    await expect(
      repository.findAuthorizationForAction("action-001"),
    ).resolves.toMatchObject({ decision: "ALLOW" });
  });

  it("fails closed and records failure when an adapter returns malformed data", async () => {
    const { boundary, execute } = await configuredBoundary({
      decision: "ALLOW",
      adapterResult: { status: "SUCCEEDED" },
    });

    const result = await boundary.execute({ actionId: "action-001" });

    expect(result).toMatchObject({
      status: "FAILED",
      execution: { status: "FAILED", errorCode: "INVALID_ADAPTER_RESULT" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("records a failed execution when the adapter throws", async () => {
    const { boundary, execute } = await configuredBoundary({ decision: "ALLOW" });
    execute.mockRejectedValueOnce(new Error("executor unavailable"));

    const result = await boundary.execute({ actionId: "action-001" });

    expect(result).toMatchObject({
      status: "FAILED",
      execution: { status: "FAILED", errorCode: "EXECUTION_ADAPTER_ERROR" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

async function configuredBoundary(options: {
  decision: "ALLOW" | "REVIEW" | "BLOCK" | null;
  agent?: Record<string, unknown> | null;
  action?: Record<string, unknown>;
  maxAmountAtomic?: string;
  adapterResult?: unknown;
}) {
  const repository = new VolatileScarRepository();
  if (options.agent !== null) {
    await repository.saveAgent(options.agent ?? validAgent());
  }
  await repository.saveAction(options.action ?? validAction());
  if (options.decision) {
    await repository.saveAuthorization(
      validAuthorization({ decision: options.decision }),
    );
  }

  const execute = vi.fn<ExecutionAdapter["execute"]>().mockResolvedValue(
    options.adapterResult ?? {
      status: "SUCCEEDED",
      externalReference: "tx-reference-001",
    },
  );
  const adapter: ExecutionAdapter = { execute };
  const clockValues = [timestamp, completedAt];
  const boundary = new ExecutionBoundary({
    repository,
    adapter,
    constraints: {
      maxAmountAtomic: options.maxAmountAtomic ?? "1000000",
      allowedChainIds: [84532],
    },
    now: () => clockValues.shift() ?? completedAt,
    createExecutionId: () => "execution-001",
  });

  return { adapter, boundary, execute, repository };
}

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

function validAuthorization(overrides: Record<string, unknown> = {}) {
  return {
    id: "authorization-001",
    actionId: "action-001",
    decision: "ALLOW",
    reasonCode: "NO_RELEVANT_INCIDENT",
    rationale: "Validated policy found no reason to restrict this action.",
    evidence: [
      {
        kind: "SYSTEM_EVENT",
        reference: "memory-check-001",
        observedAt: timestamp,
      },
    ],
    provenance: {
      engine: "SCAR_DETERMINISTIC_POLICY",
      policyVersion: "policy-v1",
      evaluatedAt: timestamp,
    },
    ...overrides,
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
