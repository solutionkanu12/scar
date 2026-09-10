import { z } from "zod";

import {
  agentSchema,
  approvalRecordSchema,
  authorizationRecordSchema,
  identifierSchema,
  protectedActionSchema,
  type CompletedExecutionRecord,
  type ProtectedAction,
} from "./domain";
import type { ExecutionAdapter } from "./ports";
import type { ScarRepository } from "./repository";

const executionRequestSchema = z
  .object({
    actionId: identifierSchema,
    approvalId: identifierSchema.optional(),
  })
  .strict();

const constraintsSchema = z
  .object({
    maxAmountAtomic: z
      .string()
      .regex(/^\d+$/)
      .refine((value) => BigInt(value) > BigInt(0)),
    allowedChainIds: z
      .array(z.number().int().positive().refine(Number.isSafeInteger))
      .min(1),
  })
  .strict();

const adapterResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("SUCCEEDED"),
      externalReference: z.string().trim().min(1).max(512),
    })
    .strict(),
  z
    .object({
      status: z.literal("FAILED"),
      errorCode: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    })
    .strict(),
]);

type RejectionReason =
  | "INVALID_REQUEST"
  | "ACTION_NOT_FOUND"
  | "INVALID_ACTION"
  | "UNAUTHORIZED_AGENT"
  | "AUTHORIZATION_MISSING"
  | "AUTHORIZATION_INVALID"
  | "DEPENDENCY_UNAVAILABLE"
  | "POLICY_LIMIT_EXCEEDED"
  | "CHAIN_NOT_ALLOWED"
  | "BLOCKED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_INVALID"
  | "DUPLICATE_ACTION";

export type ExecutionBoundaryResult =
  | { status: "REJECTED"; reason: RejectionReason }
  | { status: "SUCCEEDED"; execution: CompletedExecutionRecord }
  | { status: "FAILED"; execution: CompletedExecutionRecord };

interface ExecutionBoundaryDependencies {
  repository: ScarRepository;
  adapter: ExecutionAdapter;
  constraints: {
    maxAmountAtomic: string;
    allowedChainIds: number[];
  };
  now?: () => string;
  createExecutionId?: () => string;
}

export class ExecutionBoundary {
  private readonly constraints: z.infer<typeof constraintsSchema>;
  private readonly now: () => string;
  private readonly createExecutionId: () => string;

  constructor(private readonly dependencies: ExecutionBoundaryDependencies) {
    this.constraints = constraintsSchema.parse(dependencies.constraints);
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createExecutionId =
      dependencies.createExecutionId ?? (() => crypto.randomUUID());
  }

  async execute(input: unknown): Promise<ExecutionBoundaryResult> {
    const request = executionRequestSchema.safeParse(input);
    if (!request.success) return rejected("INVALID_REQUEST");

    let storedAction: Awaited<
      ReturnType<ScarRepository["findActionById"]>
    >;
    try {
      storedAction = await this.dependencies.repository.findActionById(
        request.data.actionId,
      );
    } catch {
      return rejected("DEPENDENCY_UNAVAILABLE");
    }
    if (!storedAction) return rejected("ACTION_NOT_FOUND");

    const action = protectedActionSchema.safeParse(storedAction);
    if (!action.success) return rejected("INVALID_ACTION");

    const policyRejection = this.checkHardConstraints(action.data);
    if (policyRejection) return rejected(policyRejection);

    let storedAgent: Awaited<ReturnType<ScarRepository["findAgentById"]>>;
    let storedAuthorization: Awaited<
      ReturnType<ScarRepository["findAuthorizationForAction"]>
    >;
    try {
      [storedAgent, storedAuthorization] = await Promise.all([
        this.dependencies.repository.findAgentById(action.data.agentId),
        this.dependencies.repository.findAuthorizationForAction(action.data.id),
      ]);
    } catch {
      return rejected("DEPENDENCY_UNAVAILABLE");
    }

    const agent = agentSchema.safeParse(storedAgent);
    if (
      !agent.success ||
      agent.data.id !== action.data.agentId ||
      agent.data.status !== "ACTIVE" ||
      !agent.data.permissions.includes(action.data.actionType)
    ) {
      return rejected("UNAUTHORIZED_AGENT");
    }

    if (!storedAuthorization) return rejected("AUTHORIZATION_MISSING");
    const authorization = authorizationRecordSchema.safeParse(
      storedAuthorization,
    );
    if (
      !authorization.success ||
      authorization.data.actionId !== action.data.id
    ) {
      return rejected("AUTHORIZATION_INVALID");
    }

    if (authorization.data.decision === "BLOCK") return rejected("BLOCKED");

    if (authorization.data.decision === "REVIEW") {
      if (!request.data.approvalId) return rejected("APPROVAL_REQUIRED");

      let storedApproval: Awaited<
        ReturnType<ScarRepository["findApprovalById"]>
      >;
      try {
        storedApproval = await this.dependencies.repository.findApprovalById(
          request.data.approvalId,
        );
      } catch {
        return rejected("DEPENDENCY_UNAVAILABLE");
      }
      const approval = approvalRecordSchema.safeParse(storedApproval);
      if (
        !approval.success ||
        approval.data.actionId !== action.data.id ||
        approval.data.authorizationId !== authorization.data.id
      ) {
        return rejected("APPROVAL_INVALID");
      }
    }

    const pendingExecution = {
      id: this.createExecutionId(),
      actionId: action.data.id,
      authorizationId: authorization.data.id,
      status: "PENDING" as const,
      startedAt: this.now(),
    };

    let claim: Awaited<ReturnType<ScarRepository["claimExecution"]>>;
    try {
      claim = await this.dependencies.repository.claimExecution(
        pendingExecution,
      );
    } catch {
      return rejected("DEPENDENCY_UNAVAILABLE");
    }
    if (!claim) return rejected("DUPLICATE_ACTION");

    let adapterOutput: unknown;
    try {
      adapterOutput = await this.dependencies.adapter.execute(action.data, {
        authorizationId: authorization.data.id,
      });
    } catch {
      return this.recordFailure(claim, "EXECUTION_ADAPTER_ERROR");
    }

    const adapterResult = adapterResultSchema.safeParse(adapterOutput);
    if (!adapterResult.success) {
      return this.recordFailure(claim, "INVALID_ADAPTER_RESULT");
    }

    const completion =
      adapterResult.data.status === "SUCCEEDED"
        ? {
            ...claim,
            status: "SUCCEEDED" as const,
            completedAt: this.now(),
            externalReference: adapterResult.data.externalReference,
          }
        : {
            ...claim,
            status: "FAILED" as const,
            completedAt: this.now(),
            errorCode: adapterResult.data.errorCode,
          };

    try {
      const execution =
        await this.dependencies.repository.completeExecution(completion);
      return { status: execution.status, execution };
    } catch {
      return rejected("DEPENDENCY_UNAVAILABLE");
    }
  }

  private checkHardConstraints(action: ProtectedAction): RejectionReason | null {
    if (BigInt(action.amountAtomic) > BigInt(this.constraints.maxAmountAtomic)) {
      return "POLICY_LIMIT_EXCEEDED";
    }
    if (!this.constraints.allowedChainIds.includes(action.chainId)) {
      return "CHAIN_NOT_ALLOWED";
    }
    return null;
  }

  private async recordFailure(
    pending: {
      id: string;
      actionId: string;
      authorizationId: string;
      startedAt: string;
    },
    errorCode: string,
  ): Promise<ExecutionBoundaryResult> {
    try {
      const execution = await this.dependencies.repository.completeExecution({
        ...pending,
        status: "FAILED",
        completedAt: this.now(),
        errorCode,
      });
      return { status: "FAILED", execution };
    } catch {
      return rejected("DEPENDENCY_UNAVAILABLE");
    }
  }
}

function rejected(reason: RejectionReason): ExecutionBoundaryResult {
  return { status: "REJECTED", reason };
}
