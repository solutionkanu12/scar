import { describe, expect, it, vi } from "vitest";

import {
  BaseExecutionAdapter,
  baseExecutionReceiptSchema,
  type BaseChainGateway,
  type BaseExecutionReceipt,
} from "@/server/scar/base-execution";
import { ExecutionBoundary } from "@/server/scar/execution-boundary";
import { VolatileScarRepository } from "@/server/scar/volatile-repository";

const timestamp = "2026-09-10T12:00:00.000Z";
const completedAt = "2026-09-10T12:00:05.000Z";
const token = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const txHash =
  "0xabc1230000000000000000000000000000000000000000000000000000000001" as const;

function fakeGateway(overrides: Partial<BaseChainGateway> = {}): BaseChainGateway {
  return {
    chainId: 84532,
    signerAddress: "0x2222222222222222222222222222222222222222",
    transferErc20: vi.fn().mockResolvedValue({ transactionHash: txHash }),
    waitForOutcome: vi
      .fn()
      .mockResolvedValue({ status: "CONFIRMED", blockNumber: BigInt(9_912_345) }),
    ...overrides,
  };
}

function validAction(overrides: Record<string, unknown> = {}) {
  return {
    id: "action-001",
    agentId: "agent-treasury",
    actionType: "USDC_TRANSFER" as const,
    amountAtomic: "1",
    entityId: "supplier-alpha",
    recipient: "0x1111111111111111111111111111111111111111",
    chainId: 84532,
    proposedAt: timestamp,
    ...overrides,
  };
}

const context = { authorizationId: "authorization-001" };

describe("BaseExecutionAdapter", () => {
  it("performs a real transfer and records full on-chain provenance", async () => {
    const receipts: BaseExecutionReceipt[] = [];
    const gateway = fakeGateway();
    const clock = [timestamp, completedAt];
    const adapter = new BaseExecutionAdapter({
      gateway,
      tokenAddress: token,
      now: () => clock.shift() ?? completedAt,
      recordReceipt: (receipt) => {
        receipts.push(receipt);
      },
    });

    const result = await adapter.execute(validAction(), context);

    expect(result).toEqual({ status: "SUCCEEDED", externalReference: txHash });
    expect(gateway.transferErc20).toHaveBeenCalledWith({
      tokenAddress: token,
      recipient: "0x1111111111111111111111111111111111111111",
      amountAtomic: BigInt(1),
    });
    expect(receipts).toHaveLength(1);
    expect(baseExecutionReceiptSchema.parse(receipts[0])).toMatchObject({
      actionId: "action-001",
      agentId: "agent-treasury",
      authorizationId: "authorization-001",
      network: "BASE_SEPOLIA",
      chainId: 84532,
      tokenAddress: token,
      recipient: "0x1111111111111111111111111111111111111111",
      amountAtomic: "1",
      transactionHash: txHash,
      blockNumber: "9912345",
      outcome: "CONFIRMED",
      submittedAt: timestamp,
      resolvedAt: completedAt,
    });
  });

  it.each([
    ["wrong chain", validAction({ chainId: 1 }), "WRONG_CHAIN"],
    [
      "malformed recipient",
      validAction({ recipient: "0x0000000000000000000000000000000000000000" }),
      "MALFORMED_RECIPIENT",
    ],
    ["zero amount", validAction({ amountAtomic: "0" }), "MALFORMED_ACTION"],
    ["corrupt action", { ...validAction(), recipient: "nope" }, "MALFORMED_ACTION"],
  ])("rejects %s before broadcasting", async (_label, action, errorCode) => {
    const gateway = fakeGateway();
    const adapter = new BaseExecutionAdapter({ gateway, tokenAddress: token });

    const result = await adapter.execute(action, context);

    expect(result).toEqual({ status: "FAILED", errorCode });
    expect(gateway.transferErc20).not.toHaveBeenCalled();
  });

  it("rejects a missing signer", async () => {
    const gateway = fakeGateway({ signerAddress: null });
    const adapter = new BaseExecutionAdapter({ gateway, tokenAddress: token });

    const result = await adapter.execute(validAction(), context);

    expect(result).toEqual({ status: "FAILED", errorCode: "MISSING_SIGNER" });
    expect(gateway.transferErc20).not.toHaveBeenCalled();
  });

  it("rejects a stale or missing authorization context", async () => {
    const gateway = fakeGateway();
    const adapter = new BaseExecutionAdapter({ gateway, tokenAddress: token });

    const result = await adapter.execute(validAction(), {
      authorizationId: "",
    });

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "MISSING_AUTHORIZATION",
    });
    expect(gateway.transferErc20).not.toHaveBeenCalled();
  });

  it("never reports success when submission fails", async () => {
    const gateway = fakeGateway({
      transferErc20: vi.fn().mockRejectedValue(new Error("rpc down")),
    });
    const adapter = new BaseExecutionAdapter({ gateway, tokenAddress: token });

    const result = await adapter.execute(validAction(), context);

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "BASE_SUBMISSION_FAILED",
    });
  });

  it("never reports success when the confirmation cannot be observed", async () => {
    const gateway = fakeGateway({
      waitForOutcome: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const adapter = new BaseExecutionAdapter({ gateway, tokenAddress: token });

    const result = await adapter.execute(validAction(), context);

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "BASE_CONFIRMATION_UNAVAILABLE",
    });
  });

  it("records a reverted on-chain transaction as a failure, not a success", async () => {
    const receipts: BaseExecutionReceipt[] = [];
    const gateway = fakeGateway({
      waitForOutcome: vi
        .fn()
        .mockResolvedValue({ status: "REVERTED", blockNumber: BigInt(9_912_346) }),
    });
    const adapter = new BaseExecutionAdapter({
      gateway,
      tokenAddress: token,
      recordReceipt: (receipt) => {
        receipts.push(receipt);
      },
    });

    const result = await adapter.execute(validAction(), context);

    expect(result).toEqual({
      status: "FAILED",
      errorCode: "BASE_TRANSACTION_REVERTED",
    });
    expect(receipts[0]?.outcome).toBe("REVERTED");
  });
});

describe("BaseExecutionAdapter behind the deterministic ExecutionBoundary", () => {
  async function boundaryWith(decision: "ALLOW" | "REVIEW" | "BLOCK") {
    const repository = new VolatileScarRepository();
    await repository.saveAgent({
      id: "agent-treasury",
      name: "Treasury Agent",
      role: "Moves approved company funds",
      status: "ACTIVE",
      permissions: ["USDC_TRANSFER"],
    });
    await repository.saveAction(validAction());
    await repository.saveAuthorization({
      id: "authorization-001",
      actionId: "action-001",
      decision,
      reasonCode: "NO_RELEVANT_RESTRICTION",
      rationale: "Deterministic policy found no reason to restrict this action.",
      evidence: [
        { kind: "SYSTEM_EVENT", reference: "lookup-001", observedAt: timestamp },
      ],
      provenance: {
        engine: "SCAR_DETERMINISTIC_POLICY",
        policyVersion: "scar-policy-v1",
        evaluatedAt: timestamp,
      },
    });
    const gateway = fakeGateway();
    const adapter = new BaseExecutionAdapter({ gateway, tokenAddress: token });
    const boundary = new ExecutionBoundary({
      repository,
      adapter,
      constraints: { maxAmountAtomic: "2000000", allowedChainIds: [84532] },
      now: () => timestamp,
      createExecutionId: () => "execution-001",
    });
    return { boundary, gateway, repository };
  }

  it("executes only an ALLOW decision and stores the transaction hash", async () => {
    const { boundary, gateway, repository } = await boundaryWith("ALLOW");

    const result = await boundary.execute({ actionId: "action-001" });

    expect(result.status).toBe("SUCCEEDED");
    expect(gateway.transferErc20).toHaveBeenCalledTimes(1);
    await expect(
      repository.findExecutionForAction("action-001"),
    ).resolves.toMatchObject({ status: "SUCCEEDED", externalReference: txHash });
  });

  it("never lets a BLOCK decision reach the Base executor", async () => {
    const { boundary, gateway } = await boundaryWith("BLOCK");

    const result = await boundary.execute({ actionId: "action-001" });

    expect(result).toEqual({ status: "REJECTED", reason: "BLOCKED" });
    expect(gateway.transferErc20).not.toHaveBeenCalled();
  });

  it("requires an explicit scoped approval before a REVIEW decision reaches Base", async () => {
    const { boundary, gateway } = await boundaryWith("REVIEW");

    const result = await boundary.execute({ actionId: "action-001" });

    expect(result).toEqual({ status: "REJECTED", reason: "APPROVAL_REQUIRED" });
    expect(gateway.transferErc20).not.toHaveBeenCalled();
  });

  it("claims the action once so a replay cannot broadcast twice", async () => {
    const { boundary, gateway } = await boundaryWith("ALLOW");

    const first = await boundary.execute({ actionId: "action-001" });
    const replay = await boundary.execute({ actionId: "action-001" });

    expect(first.status).toBe("SUCCEEDED");
    expect(replay).toEqual({ status: "REJECTED", reason: "DUPLICATE_ACTION" });
    expect(gateway.transferErc20).toHaveBeenCalledTimes(1);
  });
});
