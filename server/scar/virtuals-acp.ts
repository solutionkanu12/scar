import { z } from "zod";

import type { ActionGateResult } from "./action-gate";
import { identifierSchema } from "./domain";
import {
  ExecutionBoundary,
  type ExecutionBoundaryResult,
} from "./execution-boundary";
import type { ExecutionAdapter, ExecutionContext } from "./ports";
import type { ScarRepository } from "./repository";

/**
 * Virtuals ACP integration boundary.
 *
 * Scar's logical Treasury Agent acts as the ACP buyer/client and the logical
 * Procurement Agent acts as the ACP provider/seller. The consequential on-chain
 * action for a procurement job is the ACP settlement itself
 * (`payAndAcceptRequirement`). It is performed only through Scar's deterministic
 * authorization boundary:
 *
 *   Virtuals ACP job -> Scar deterministic gate -> ExecutionBoundary
 *     -> AcpSettlementAdapter.payJob -> outcome recorded
 *
 * A `BLOCK` decision leaves the ACP job unpaid. A `REVIEW` decision requires an
 * exact action-and-authorization scoped approval. Only an `ALLOW` (or an
 * approved `REVIEW`) reaches the executor and settles the ACP job. There is no
 * second transfer: the ACP payment is the single real settlement.
 *
 * The concrete {@link VirtualsAcpGateway} implementation
 * (`acp-virtuals-gateway.ts`) wraps the official `@virtuals-protocol/acp-node`
 * SDK against the Base Sepolia ACP sandbox. It holds only the whitelisted signer
 * and has no authorization or execution capability.
 */

const hexAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const timestampSchema = z.string().datetime({ offset: true });

export const virtualsAgentRefSchema = z
  .object({
    label: z.string().trim().min(1).max(160),
    role: z.enum(["TREASURY_BUYER", "PROCUREMENT_SELLER"]),
    walletAddress: hexAddressSchema,
    /** ACP registry agent id / session entity id. */
    entityId: z.string().trim().min(1).max(256),
  })
  .strict();

export const acpJobRefSchema = z
  .object({
    jobId: z.string().trim().min(1).max(256),
    phase: z.string().trim().min(1).max(64),
    clientAddress: hexAddressSchema,
    providerAddress: hexAddressSchema,
    priceAtomic: z.string().regex(/^\d+$/),
  })
  .strict();

export const acpSettlementSchema = z
  .object({
    job: acpJobRefSchema,
    transactionHash: z.string().trim().min(1).max(256),
  })
  .strict();

export const virtualsInteractionRecordSchema = z
  .object({
    acpJobId: z.string().trim().min(1).max(256),
    serviceQuery: z.string().trim().min(1).max(240),
    buyer: virtualsAgentRefSchema,
    seller: virtualsAgentRefSchema,
    phases: z.array(z.string().trim().min(1).max(64)).min(1).max(64),
    scarActionId: identifierSchema,
    scarAuthorizationId: identifierSchema.nullable(),
    scarDecision: z.enum(["ALLOW", "REVIEW", "BLOCK"]),
    settlementReference: z.string().trim().min(1).max(512).nullable(),
    outcome: z.enum([
      "SETTLED",
      "BLOCKED_BY_SCAR",
      "REVIEW_REQUIRED",
      "SETTLEMENT_REJECTED",
      "SETTLEMENT_FAILED",
      "NO_PROVIDER",
    ]),
    recordedAt: timestampSchema,
  })
  .strict();

export type VirtualsAgentRef = z.infer<typeof virtualsAgentRefSchema>;
export type AcpJobRef = z.infer<typeof acpJobRefSchema>;
export type AcpSettlement = z.infer<typeof acpSettlementSchema>;
export type VirtualsInteractionRecord = z.infer<
  typeof virtualsInteractionRecordSchema
>;

export interface VirtualsAcpGateway {
  readonly buyer: VirtualsAgentRef;
  browseProviders(serviceQuery: string): Promise<VirtualsAgentRef[]>;
  initiateJob(input: {
    provider: VirtualsAgentRef;
    serviceQuery: string;
    requirement: Record<string, unknown>;
    priceAtomic: string;
  }): Promise<AcpJobRef>;
  /** Performs `payAndAcceptRequirement`; returns the settlement transaction. */
  payJob(jobId: string): Promise<AcpSettlement>;
  getJob(jobId: string): Promise<AcpJobRef>;
}

/**
 * `ExecutionAdapter` whose consequential action is settling one ACP job. The
 * job is bound per run by {@link VirtualsProcurementBridge}; the surrounding
 * {@link ExecutionBoundary} still enforces `BLOCK` rejection, scoped `REVIEW`
 * approval, hard limits, and the single atomic execution claim.
 */
export class AcpSettlementAdapter implements ExecutionAdapter {
  private boundJobId: string | null = null;

  constructor(private readonly acp: VirtualsAcpGateway) {}

  bindJob(jobId: string): void {
    this.boundJobId = jobId;
  }

  async execute(
    _action: unknown,
    context: ExecutionContext,
  ): Promise<
    | { status: "SUCCEEDED"; externalReference: string }
    | { status: "FAILED"; errorCode: string }
  > {
    if (!this.boundJobId) {
      return { status: "FAILED", errorCode: "ACP_JOB_NOT_BOUND" };
    }
    if (!context?.authorizationId) {
      return { status: "FAILED", errorCode: "MISSING_AUTHORIZATION" };
    }
    try {
      const settlement = acpSettlementSchema.parse(
        await this.acp.payJob(this.boundJobId),
      );
      return {
        status: "SUCCEEDED",
        externalReference: settlement.transactionHash,
      };
    } catch {
      return { status: "FAILED", errorCode: "ACP_SETTLEMENT_FAILED" };
    }
  }
}

export interface VirtualsProcurementResult {
  outcome: VirtualsInteractionRecord["outcome"];
  record: VirtualsInteractionRecord | null;
  job: AcpJobRef | null;
  decision: ActionGateResult;
  execution: ExecutionBoundaryResult | null;
}

interface VirtualsProcurementBridgeDependencies {
  repository: ScarRepository;
  gate: { authorize(input: { actionId: string }): Promise<ActionGateResult> };
  acp: VirtualsAcpGateway;
  constraints: { maxAmountAtomic: string; allowedChainIds: number[] };
  now?: () => string;
  recordInteraction?: (
    record: VirtualsInteractionRecord,
  ) => Promise<void> | void;
}

export class VirtualsProcurementBridge {
  private readonly repository: ScarRepository;
  private readonly gate: VirtualsProcurementBridgeDependencies["gate"];
  private readonly acp: VirtualsAcpGateway;
  private readonly constraints: VirtualsProcurementBridgeDependencies["constraints"];
  private readonly now: () => string;
  private readonly recordInteraction?: (
    record: VirtualsInteractionRecord,
  ) => Promise<void> | void;

  constructor(dependencies: VirtualsProcurementBridgeDependencies) {
    this.repository = dependencies.repository;
    this.gate = dependencies.gate;
    this.acp = dependencies.acp;
    this.constraints = dependencies.constraints;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.recordInteraction = dependencies.recordInteraction;
  }

  async runProcurement(input: {
    actionId: string;
    serviceQuery: string;
    requirement: Record<string, unknown>;
    priceAtomic: string;
    approvalId?: string;
  }): Promise<VirtualsProcurementResult> {
    const providers = await this.acp.browseProviders(input.serviceQuery);
    const seller =
      providers.find((agent) => agent.role === "PROCUREMENT_SELLER") ??
      providers[0];
    if (!seller) {
      // No provider was ever contacted; there is nothing to authorize or pay.
      return {
        outcome: "NO_PROVIDER",
        record: null,
        job: null,
        decision: noProviderDecision(),
        execution: null,
      };
    }

    const job = await this.acp.initiateJob({
      provider: seller,
      serviceQuery: input.serviceQuery,
      requirement: input.requirement,
      priceAtomic: input.priceAtomic,
    });
    const phases = [job.phase];

    const decision = await this.gate.authorize({ actionId: input.actionId });

    const adapter = new AcpSettlementAdapter(this.acp);
    adapter.bindJob(job.jobId);
    const executor = new ExecutionBoundary({
      repository: this.repository,
      adapter,
      constraints: this.constraints,
      now: this.now,
    });

    const finish = async (
      outcome: VirtualsInteractionRecord["outcome"],
      settlementReference: string | null,
      currentJob: AcpJobRef,
      execution: ExecutionBoundaryResult | null,
    ): Promise<VirtualsProcurementResult> => {
      const record = virtualsInteractionRecordSchema.parse({
        acpJobId: currentJob.jobId,
        serviceQuery: input.serviceQuery,
        buyer: this.acp.buyer,
        seller,
        phases: dedupe([...phases, currentJob.phase]),
        scarActionId: input.actionId,
        scarAuthorizationId: decision.authorizationId,
        scarDecision: decision.decision,
        settlementReference,
        outcome,
        recordedAt: this.now(),
      });
      await this.recordInteraction?.(record);
      return { outcome, record, job: currentJob, decision, execution };
    };

    if (decision.decision === "BLOCK") {
      return finish("BLOCKED_BY_SCAR", null, job, null);
    }
    if (decision.decision === "REVIEW" && !input.approvalId) {
      return finish("REVIEW_REQUIRED", null, job, null);
    }

    const execution = await executor.execute({
      actionId: input.actionId,
      approvalId: input.approvalId,
    });
    if (execution.status === "REJECTED") {
      return finish("SETTLEMENT_REJECTED", null, job, execution);
    }
    if (execution.status === "FAILED") {
      return finish("SETTLEMENT_FAILED", null, job, execution);
    }

    const settledJob = await this.acp.getJob(job.jobId);
    return finish(
      "SETTLED",
      execution.execution.status === "SUCCEEDED"
        ? execution.execution.externalReference
        : null,
      settledJob,
      execution,
    );
  }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function noProviderDecision(): ActionGateResult {
  return {
    actionId: null,
    authorizationId: null,
    decision: "BLOCK",
    reasonCode: "NO_ACP_PROVIDER",
    rationale: "No Virtuals ACP provider responded to the procurement query.",
    evidence: [
      {
        kind: "SYSTEM_EVENT",
        reference: "NO_ACP_PROVIDER",
        observedAt: new Date(0).toISOString(),
      },
    ],
    provenance: {
      engine: "SCAR_DETERMINISTIC_POLICY",
      policyVersion: "SCAR_NO_PROVIDER",
      evaluatedAt: new Date(0).toISOString(),
    },
  };
}
