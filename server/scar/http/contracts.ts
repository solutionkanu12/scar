import { z } from "zod";

import { identifierSchema } from "../domain";

const timestampSchema = z.string().datetime({ offset: true });

export const scarRoleSchema = z.enum([
  "ADMIN",
  "OPERATOR",
  "APPROVER",
  "SAFETY_OFFICER",
]);

export const principalStatusSchema = z.enum(["ACTIVE", "REVOKED"]);

export const workspaceKindSchema = z.enum(["PERSONAL", "ORGANIZATION"]);
export const workspaceStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);
export const workspaceMembershipSchema = z.enum(["OWNER", "MEMBER"]);
export const workspaceMembershipStatusSchema = z.enum(["ACTIVE", "REVOKED"]);
export const workspaceRoleChangeSchema = z.enum(["ASSIGNED", "REVOKED"]);
export const workspaceExecutionStatusSchema = z.enum(["DISABLED", "ENABLED"]);

export const workspaceRecordSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(120),
    kind: workspaceKindSchema,
    status: workspaceStatusSchema,
    createdAt: timestampSchema,
  })
  .strict();

export const workspaceMembershipRecordSchema = z
  .object({
    workspaceId: identifierSchema,
    userId: z.string().uuid(),
    membership: workspaceMembershipSchema,
    status: workspaceMembershipStatusSchema,
    addedBy: z.string().uuid(),
    createdAt: timestampSchema,
    revokedAt: timestampSchema.nullable().optional(),
  })
  .strict();

export const workspaceRoleAssignmentSchema = z
  .object({
    workspaceId: identifierSchema,
    userId: z.string().uuid(),
    role: scarRoleSchema,
    status: principalStatusSchema,
    assignedBy: z.string().uuid(),
    assignedAt: timestampSchema,
    revokedBy: z.string().uuid().nullable().optional(),
    revokedAt: timestampSchema.nullable().optional(),
  })
  .strict();

export const workspaceRoleAuditRecordSchema = z
  .object({
    id: identifierSchema,
    workspaceId: identifierSchema,
    userId: z.string().uuid(),
    role: scarRoleSchema,
    change: workspaceRoleChangeSchema,
    actorUserId: z.string().uuid(),
    occurredAt: timestampSchema,
  })
  .strict();

export const workspaceExecutionConfigurationSchema = z
  .object({
    workspaceId: identifierSchema,
    status: workspaceExecutionStatusSchema,
    executorKeyReference: identifierSchema.nullable().optional(),
    chainId: z.number().int().positive().safe().nullable().optional(),
    tokenAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).nullable().optional(),
    configuredBy: z.string().uuid().nullable().optional(),
    configuredAt: timestampSchema.nullable().optional(),
  })
  .strict()
  .superRefine((configuration, context) => {
    const enabled = configuration.status === "ENABLED";
    const complete =
      Boolean(configuration.executorKeyReference) &&
      configuration.chainId !== null &&
      configuration.chainId !== undefined &&
      Boolean(configuration.tokenAddress) &&
      Boolean(configuration.configuredBy) &&
      Boolean(configuration.configuredAt);
    if (enabled !== complete) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Enabled workspace execution requires a server-resolved key reference and complete chain configuration.",
      });
    }
  });

export const createWorkspaceForOwnerSchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(120),
    kind: workspaceKindSchema,
    ownerUserId: z.string().uuid(),
    createdAt: timestampSchema,
  })
  .strict();

export const addWorkspaceMemberSchema = z
  .object({
    workspaceId: identifierSchema,
    userId: z.string().uuid(),
    membership: z.literal("MEMBER"),
    addedBy: z.string().uuid(),
    createdAt: timestampSchema,
  })
  .strict();

export const revokeWorkspaceMemberSchema = z
  .object({
    workspaceId: identifierSchema,
    userId: z.string().uuid(),
    revokedBy: z.string().uuid(),
    revokedAt: timestampSchema,
  })
  .strict();

export const assignWorkspaceRoleSchema = z
  .object({
    id: identifierSchema,
    workspaceId: identifierSchema,
    userId: z.string().uuid(),
    role: scarRoleSchema,
    assignedBy: z.string().uuid(),
    occurredAt: timestampSchema,
  })
  .strict();

export const revokeWorkspaceRoleSchema = z
  .object({
    id: identifierSchema,
    workspaceId: identifierSchema,
    userId: z.string().uuid(),
    role: scarRoleSchema,
    revokedBy: z.string().uuid(),
    occurredAt: timestampSchema,
  })
  .strict();

export const humanRoleRecordSchema = z
  .object({
    userId: z.string().uuid(),
    role: scarRoleSchema,
    status: principalStatusSchema,
    createdAt: timestampSchema,
    revokedAt: timestampSchema.nullable().optional(),
  })
  .strict();

export const agentOperationSchema = z.enum([
  "PROPOSE_ACTION",
  "EVALUATE_ACTION",
  "EXECUTE_ACTION",
  "READ_ACTION",
]);

export const agentCredentialRecordSchema = z
  .object({
    workspaceId: identifierSchema,
    id: identifierSchema,
    agentId: identifierSchema,
    secretHash: z.string().regex(/^[a-f0-9]{64}$/),
    allowedOperations: z.array(agentOperationSchema).min(1).max(4),
    status: principalStatusSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    revokedAt: timestampSchema.nullable().optional(),
  })
  .strict()
  .superRefine((credential, context) => {
    if (new Set(credential.allowedOperations).size !== credential.allowedOperations.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedOperations"],
        message: "Agent credential operations must be unique",
      });
    }
  });

export const httpOperationSchema = z.enum([
  "WORKSPACE_CREATION",
  "WORKSPACE_MEMBER_ADDITION",
  "WORKSPACE_MEMBER_REVOCATION",
  "WORKSPACE_ROLE_ASSIGNMENT",
  "WORKSPACE_ROLE_REVOCATION",
  "AGENT_REGISTRATION",
  "CREDENTIAL_ISSUE",
  "CREDENTIAL_REVOCATION",
  "ACTION_PROPOSAL",
  "ACTION_EVALUATION",
  "ACTION_APPROVAL",
  "ACTION_EXECUTION",
  "INCIDENT_RECORDING",
  "OUTCOME_RECORDING",
  "INCIDENT_RETRY",
  "ACTION_READ",
]);

export const httpAuditRecordSchema = z
  .object({
    id: identifierSchema,
    workspaceId: identifierSchema,
    requestId: identifierSchema,
    principalType: z.enum(["HUMAN", "AGENT"]),
    principalId: identifierSchema,
    operation: httpOperationSchema,
    actionId: identifierSchema.nullable().optional(),
    incidentId: identifierSchema.nullable().optional(),
    outcome: z.enum(["ACCEPTED", "COMPLETED", "REJECTED", "FAILED"]),
    statusCode: z.number().int().min(100).max(599),
    occurredAt: timestampSchema,
  })
  .strict();

export const rateLimitClaimSchema = z
  .object({
    workspaceId: identifierSchema,
    principalId: identifierSchema,
    operation: httpOperationSchema,
    windowStartedAt: timestampSchema,
    limit: z.number().int().positive().max(10_000),
  })
  .strict();

export type ScarRole = z.infer<typeof scarRoleSchema>;
export type WorkspaceRecord = z.infer<typeof workspaceRecordSchema>;
export type WorkspaceMembershipRecord = z.infer<
  typeof workspaceMembershipRecordSchema
>;
export type WorkspaceRoleAssignment = z.infer<
  typeof workspaceRoleAssignmentSchema
>;
export type WorkspaceRoleAuditRecord = z.infer<
  typeof workspaceRoleAuditRecordSchema
>;
export type WorkspaceExecutionConfiguration = z.infer<
  typeof workspaceExecutionConfigurationSchema
>;
export type HumanRoleRecord = z.infer<typeof humanRoleRecordSchema>;
export type AgentOperation = z.infer<typeof agentOperationSchema>;
export type AgentCredentialRecord = z.infer<typeof agentCredentialRecordSchema>;
export type HttpOperation = z.infer<typeof httpOperationSchema>;
export type HttpAuditRecord = z.infer<typeof httpAuditRecordSchema>;
export type RateLimitClaim = z.infer<typeof rateLimitClaimSchema>;
