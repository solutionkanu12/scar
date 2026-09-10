import { describe, expect, it } from "vitest";

import { DeterministicActionGate } from "@/server/scar/action-gate";
import {
  BaseExecutionAdapter,
  baseExecutionReceiptSchema,
  type BaseExecutionReceipt,
} from "@/server/scar/base-execution";
import { ExecutionBoundary } from "@/server/scar/execution-boundary";
import type { FreshSessionMemoryReader } from "@/server/scar/fresh-session-retrieval";
import { ViemBaseChainGateway } from "@/server/scar/viem-base-chain-gateway";
import { VolatileScarRepository } from "@/server/scar/volatile-repository";

/**
 * Real Base Sepolia (84532) execution proof.
 *
 * Skipped unless `SCAR_BASE_EXECUTOR_PRIVATE_KEY` is set to a funded Base
 * Sepolia key (needs test ETH for gas and Circle test USDC for the transfer).
 * Run with `npm run test:base`.
 *
 * Optional environment:
 * - `SCAR_BASE_SEPOLIA_RPC_URL` (default https://sepolia.base.org)
 * - `SCAR_BASE_USDC_ADDRESS` (default Circle Base Sepolia test USDC)
 * - `SCAR_BASE_RECIPIENT` (default the sender address, a self-transfer)
 */

const privateKey = process.env.SCAR_BASE_EXECUTOR_PRIVATE_KEY;
const integration = privateKey ? describe : describe.skip;

const rpcUrl =
  process.env.SCAR_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const usdcAddress =
  process.env.SCAR_BASE_USDC_ADDRESS ??
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const timestamp = "2026-09-10T12:00:00.000Z";

function cleanMemory(): FreshSessionMemoryReader {
  return {
    async findRelevantEvidence() {
      return {
        status: "AVAILABLE",
        lookupId: "lookup-clean-base",
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

integration("real Base Sepolia execution", () => {
  it("executes the smallest USDC transfer through the deterministic gate and records the receipt", async () => {
    const gateway = new ViemBaseChainGateway({
      rpcUrl,
      privateKey: privateKey as string,
    });
    const signer = gateway.signerAddress;
    if (!signer) throw new Error("configured key did not resolve to a signer");
    const recipient = process.env.SCAR_BASE_RECIPIENT ?? signer;

    const repository = new VolatileScarRepository();
    await repository.saveAgent({
      id: "agent-treasury",
      name: "Treasury Agent",
      role: "Moves approved company funds",
      status: "ACTIVE",
      permissions: ["USDC_TRANSFER"],
    });
    await repository.saveAction({
      id: "action-base-proof-001",
      agentId: "agent-treasury",
      actionType: "USDC_TRANSFER",
      amountAtomic: "1",
      entityId: "supplier-alpha",
      recipient,
      chainId: 84532,
      proposedAt: timestamp,
    });

    const gate = new DeterministicActionGate({
      repository,
      memory: cleanMemory(),
      policy: {
        policyVersion: "scar-policy-v1",
        maxAmountAtomic: "1000000",
        reviewAmountAtomic: "500000",
        allowedChainIds: [84532],
      },
      now: () => new Date().toISOString(),
      createAuthorizationId: () => "authorization-base-proof-001",
    });

    const decision = await gate.authorize({ actionId: "action-base-proof-001" });
    expect(decision.decision).toBe("ALLOW");

    const receipts: BaseExecutionReceipt[] = [];
    const boundary = new ExecutionBoundary({
      repository,
      adapter: new BaseExecutionAdapter({
        gateway,
        tokenAddress: usdcAddress,
        recordReceipt: (receipt) => {
          receipts.push(receipt);
        },
      }),
      constraints: { maxAmountAtomic: "1000000", allowedChainIds: [84532] },
    });

    const result = await boundary.execute({
      actionId: "action-base-proof-001",
    });

    expect(result.status).toBe("SUCCEEDED");
    if (result.status !== "SUCCEEDED" || result.execution.status !== "SUCCEEDED") {
      throw new Error("execution did not succeed");
    }
    const externalReference = result.execution.externalReference;
    expect(externalReference).toMatch(/^0x[0-9a-fA-F]{64}$/);

    expect(receipts).toHaveLength(1);
    const receipt = baseExecutionReceiptSchema.parse(receipts[0]);
    expect(receipt).toMatchObject({
      actionId: "action-base-proof-001",
      agentId: "agent-treasury",
      authorizationId: "authorization-base-proof-001",
      network: "BASE_SEPOLIA",
      chainId: 84532,
      recipient,
      amountAtomic: "1",
      outcome: "CONFIRMED",
    });
    expect(receipt.transactionHash).toBe(externalReference);

    console.log(
      `Base Sepolia proof tx: https://sepolia.basescan.org/tx/${receipt.transactionHash} (block ${receipt.blockNumber})`,
    );

    const replay = await boundary.execute({
      actionId: "action-base-proof-001",
    });
    expect(replay).toEqual({ status: "REJECTED", reason: "DUPLICATE_ACTION" });
  }, 180_000);
});
