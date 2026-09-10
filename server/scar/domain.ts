import { z } from "zod";

const UINT256_MAX = BigInt(
  "115792089237316195423570985008687907853269984665640564039457584007913129639935",
);

export const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const timestampSchema = z.string().datetime({ offset: true });

export const actionTypeSchema = z.enum(["USDC_TRANSFER"]);

export const agentSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(240),
    status: z.enum(["ACTIVE", "SUSPENDED"]),
    permissions: z.array(actionTypeSchema).max(16),
  })
  .strict();

const atomicAmountSchema = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => {
    const amount = BigInt(value);
    return amount > BigInt(0) && amount <= UINT256_MAX;
  });

export const protectedActionSchema = z
  .object({
    id: identifierSchema,
    agentId: identifierSchema,
    actionType: actionTypeSchema,
    amountAtomic: atomicAmountSchema,
    entityId: identifierSchema,
    recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    chainId: z.number().int().positive().refine(Number.isSafeInteger),
    proposedAt: timestampSchema,
  })
  .strict();

export const evidenceReferenceSchema = z
  .object({
    kind: z.enum(["TRANSACTION", "OPERATOR_NOTE", "SYSTEM_EVENT"]),
    reference: z.string().trim().min(1).max(512),
    observedAt: timestampSchema,
  })
  .strict();

export const incidentSchema = z
  .object({
    id: identifierSchema,
    sourceAgentId: identifierSchema,
    relatedActionId: identifierSchema,
    entityId: identifierSchema,
    actionType: actionTypeSchema,
    context: z.string().trim().min(1).max(4_000),
    outcome: z.string().trim().min(1).max(4_000),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    reason: z.string().trim().min(1).max(2_000),
    mitigation: z.string().trim().min(1).max(2_000),
    evidence: z.array(evidenceReferenceSchema).min(1).max(64),
    provenance: z
      .object({
        source: z.enum(["OPERATOR_REPORT", "EXECUTION_OUTCOME"]),
        recordedBy: identifierSchema,
        observedAt: timestampSchema,
      })
      .strict(),
    createdAt: timestampSchema,
  })
  .strict();

export const incidentQuerySchema = z
  .object({
    entityId: identifierSchema.optional(),
    actionType: actionTypeSchema.optional(),
  })
  .strict();

export const authorizationRecordSchema = z
  .object({
    id: identifierSchema,
    actionId: identifierSchema,
    decision: z.enum(["ALLOW", "REVIEW", "BLOCK"]),
    reasonCode: identifierSchema,
    rationale: z.string().trim().min(1).max(2_000),
    evidence: z.array(evidenceReferenceSchema).min(1).max(64),
    provenance: z
      .object({
        engine: z.literal("SCAR_DETERMINISTIC_POLICY"),
        policyVersion: identifierSchema,
        evaluatedAt: timestampSchema,
      })
      .strict(),
  })
  .strict();

export const approvalRecordSchema = z
  .object({
    id: identifierSchema,
    actionId: identifierSchema,
    authorizationId: identifierSchema,
    approvedBy: identifierSchema,
    approvedAt: timestampSchema,
  })
  .strict();

const executionBaseShape = {
  id: identifierSchema,
  actionId: identifierSchema,
  authorizationId: identifierSchema,
  startedAt: timestampSchema,
};

export const pendingExecutionRecordSchema = z
  .object({
    ...executionBaseShape,
    status: z.literal("PENDING"),
  })
  .strict();

export const completedExecutionRecordSchema = z.discriminatedUnion("status", [
  z
    .object({
      ...executionBaseShape,
      status: z.literal("SUCCEEDED"),
      completedAt: timestampSchema,
      externalReference: z.string().trim().min(1).max(512),
    })
    .strict(),
  z
    .object({
      ...executionBaseShape,
      status: z.literal("FAILED"),
      completedAt: timestampSchema,
      errorCode: identifierSchema,
    })
    .strict(),
]);

export const executionRecordSchema = z.union([
  pendingExecutionRecordSchema,
  completedExecutionRecordSchema,
]);

export type ActionType = z.infer<typeof actionTypeSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type ProtectedAction = z.infer<typeof protectedActionSchema>;
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;
export type Incident = z.infer<typeof incidentSchema>;
export type IncidentQuery = z.infer<typeof incidentQuerySchema>;
export type AuthorizationRecord = z.infer<typeof authorizationRecordSchema>;
export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;
export type PendingExecutionRecord = z.infer<
  typeof pendingExecutionRecordSchema
>;
export type CompletedExecutionRecord = z.infer<
  typeof completedExecutionRecordSchema
>;
export type ExecutionRecord = z.infer<typeof executionRecordSchema>;
