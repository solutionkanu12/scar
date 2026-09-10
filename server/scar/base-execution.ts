import { z } from "zod";

import { identifierSchema, protectedActionSchema } from "./domain";
import type { ExecutionAdapter, ExecutionContext } from "./ports";

/**
 * Base execution boundary.
 *
 * This module performs a real on-chain USDC transfer on the Base Sepolia test
 * network (chain id 84532), which is the Base test network accepted for the
 * hackathon demo. It is only ever reached from {@link ExecutionBoundary}, which
 * independently enforces that:
 *
 * - only an `ALLOW` authorization executes automatically,
 * - a `REVIEW` authorization requires an exact action-and-authorization scoped
 *   human approval before execution,
 * - a `BLOCK` authorization never reaches this adapter,
 * - duplicate / replayed actions are claimed once and cannot execute twice.
 *
 * This adapter adds transaction-input validation and never reports a success it
 * did not observe on chain. Signing material lives only inside a
 * {@link BaseChainGateway} implementation and is never passed to or logged by
 * this adapter.
 */

export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;

const hexAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .refine(
    (value) => value.toLowerCase() !== "0x0000000000000000000000000000000000000000",
    "The zero address is not a valid transfer target",
  );

const transactionHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const UINT256_MAX = BigInt(
  "115792089237316195423570985008687907853269984665640564039457584007913129639935",
);

const timestampSchema = z.string().datetime({ offset: true });

export const baseExecutionReceiptSchema = z
  .object({
    actionId: identifierSchema,
    agentId: identifierSchema,
    authorizationId: identifierSchema,
    network: z.literal("BASE_SEPOLIA"),
    chainId: z.literal(BASE_SEPOLIA_CHAIN_ID),
    tokenAddress: hexAddressSchema,
    recipient: hexAddressSchema,
    amountAtomic: z.string().regex(/^\d+$/),
    transactionHash: transactionHashSchema,
    blockNumber: z.string().regex(/^\d+$/),
    outcome: z.enum(["CONFIRMED", "REVERTED"]),
    submittedAt: timestampSchema,
    resolvedAt: timestampSchema,
  })
  .strict();

export type BaseExecutionReceipt = z.infer<typeof baseExecutionReceiptSchema>;

export type BaseExecutionErrorCode =
  | "MALFORMED_ACTION"
  | "UNSUPPORTED_ACTION_TYPE"
  | "WRONG_CHAIN"
  | "MALFORMED_RECIPIENT"
  | "INVALID_AMOUNT"
  | "MISSING_SIGNER"
  | "MISSING_AUTHORIZATION"
  | "MISCONFIGURED_TOKEN"
  | "BASE_SUBMISSION_FAILED"
  | "BASE_CONFIRMATION_UNAVAILABLE"
  | "BASE_TRANSACTION_REVERTED";

export type BaseAdapterResult =
  | { status: "SUCCEEDED"; externalReference: string }
  | { status: "FAILED"; errorCode: BaseExecutionErrorCode };

/**
 * Narrow port around the parts of Base that this adapter touches. The
 * implementation owns the RPC endpoint and the server-side signer; callers of
 * the adapter never see either.
 */
export interface BaseChainGateway {
  /** Chain id the gateway is bound to. Used to reject a misconfigured signer. */
  readonly chainId: number;
  /** Signer address, or `null` when no signing key is configured. */
  readonly signerAddress: string | null;
  transferErc20(input: {
    tokenAddress: `0x${string}`;
    recipient: `0x${string}`;
    amountAtomic: bigint;
  }): Promise<{ transactionHash: `0x${string}` }>;
  waitForOutcome(transactionHash: `0x${string}`): Promise<{
    status: "CONFIRMED" | "REVERTED";
    blockNumber: bigint;
  }>;
}

interface BaseExecutionAdapterDependencies {
  gateway: BaseChainGateway;
  /** ERC-20 token contract used for `USDC_TRANSFER` actions on Base Sepolia. */
  tokenAddress: string;
  now?: () => string;
  /**
   * Sink for the durable execution receipt. The {@link ExecutionBoundary} still
   * records its own `CompletedExecutionRecord`; this receipt carries the full
   * on-chain provenance (network, token, block, timestamps, outcome).
   */
  recordReceipt?: (receipt: BaseExecutionReceipt) => Promise<void> | void;
}

export class BaseExecutionAdapter implements ExecutionAdapter {
  private readonly gateway: BaseChainGateway;
  private readonly tokenAddress: string;
  private readonly now: () => string;
  private readonly recordReceipt?: (
    receipt: BaseExecutionReceipt,
  ) => Promise<void> | void;

  constructor(dependencies: BaseExecutionAdapterDependencies) {
    this.gateway = dependencies.gateway;
    this.tokenAddress = dependencies.tokenAddress;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.recordReceipt = dependencies.recordReceipt;
  }

  async execute(
    actionInput: unknown,
    context?: ExecutionContext,
  ): Promise<BaseAdapterResult> {
    const parsedAction = protectedActionSchema.safeParse(actionInput);
    if (!parsedAction.success) return fail("MALFORMED_ACTION");
    const action = parsedAction.data;

    if (action.actionType !== "USDC_TRANSFER") {
      return fail("UNSUPPORTED_ACTION_TYPE");
    }
    if (
      action.chainId !== BASE_SEPOLIA_CHAIN_ID ||
      this.gateway.chainId !== BASE_SEPOLIA_CHAIN_ID
    ) {
      return fail("WRONG_CHAIN");
    }

    const recipient = hexAddressSchema.safeParse(action.recipient);
    if (!recipient.success) return fail("MALFORMED_RECIPIENT");

    let amount: bigint;
    try {
      amount = BigInt(action.amountAtomic);
    } catch {
      return fail("INVALID_AMOUNT");
    }
    if (amount <= BigInt(0) || amount > UINT256_MAX) {
      return fail("INVALID_AMOUNT");
    }

    if (!this.gateway.signerAddress) return fail("MISSING_SIGNER");

    const authorizationId = context?.authorizationId;
    if (!authorizationId || !identifierSchema.safeParse(authorizationId).success) {
      return fail("MISSING_AUTHORIZATION");
    }

    const token = hexAddressSchema.safeParse(this.tokenAddress);
    if (!token.success) return fail("MISCONFIGURED_TOKEN");

    const submittedAt = this.now();

    let transactionHash: `0x${string}`;
    try {
      ({ transactionHash } = await this.gateway.transferErc20({
        tokenAddress: token.data as `0x${string}`,
        recipient: recipient.data as `0x${string}`,
        amountAtomic: amount,
      }));
    } catch {
      return fail("BASE_SUBMISSION_FAILED");
    }

    if (!transactionHashSchema.safeParse(transactionHash).success) {
      return fail("BASE_SUBMISSION_FAILED");
    }

    let outcome: { status: "CONFIRMED" | "REVERTED"; blockNumber: bigint };
    try {
      outcome = await this.gateway.waitForOutcome(transactionHash);
    } catch {
      // The transaction was broadcast but its outcome could not be observed.
      // Never report success we did not see confirmed on chain.
      return fail("BASE_CONFIRMATION_UNAVAILABLE");
    }

    const receipt = baseExecutionReceiptSchema.parse({
      actionId: action.id,
      agentId: action.agentId,
      authorizationId,
      network: "BASE_SEPOLIA",
      chainId: BASE_SEPOLIA_CHAIN_ID,
      tokenAddress: token.data,
      recipient: recipient.data,
      amountAtomic: action.amountAtomic,
      transactionHash,
      blockNumber: outcome.blockNumber.toString(),
      outcome: outcome.status,
      submittedAt,
      resolvedAt: this.now(),
    });

    try {
      await this.recordReceipt?.(receipt);
    } catch {
      return fail("BASE_CONFIRMATION_UNAVAILABLE");
    }

    if (outcome.status === "REVERTED") {
      return { status: "FAILED", errorCode: "BASE_TRANSACTION_REVERTED" };
    }
    return { status: "SUCCEEDED", externalReference: transactionHash };
  }
}

function fail(errorCode: BaseExecutionErrorCode): BaseAdapterResult {
  return { status: "FAILED", errorCode };
}
