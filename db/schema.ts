import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import type {
  ActionType,
  AuthorizationRecord,
  EvidenceReference,
  Incident,
} from "@/server/scar/domain";
import type { ScarMemoryBundle } from "@/server/scar/sibyl-contract";
import type {
  AgentOperation,
  HttpOperation,
  ScarRole,
} from "@/server/scar/http/contracts";

export const agents = sqliteTable(
  "agents",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    status: text("status", { enum: ["ACTIVE", "SUSPENDED"] }).notNull(),
    permissions: text("permissions", { mode: "json" })
      .$type<ActionType[]>()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.id] })],
);

export const protectedActions = sqliteTable(
  "protected_actions",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    agentId: text("agent_id").notNull(),
    actionType: text("action_type", { enum: ["USDC_TRANSFER"] }).notNull(),
    amountAtomic: text("amount_atomic").notNull(),
    entityId: text("entity_id").notNull(),
    recipient: text("recipient").notNull(),
    chainId: integer("chain_id").notNull(),
    proposedAt: text("proposed_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.id] })],
);

export const incidents = sqliteTable(
  "incidents",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    sourceAgentId: text("source_agent_id").notNull(),
    relatedActionId: text("related_action_id").notNull(),
    entityId: text("entity_id").notNull(),
    actionType: text("action_type", { enum: ["USDC_TRANSFER"] }).notNull(),
    context: text("context").notNull(),
    outcome: text("outcome").notNull(),
    severity: text("severity", {
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
    }).notNull(),
    reason: text("reason").notNull(),
    mitigation: text("mitigation").notNull(),
    evidence: text("evidence", { mode: "json" })
      .$type<EvidenceReference[]>()
      .notNull(),
    provenance: text("provenance", { mode: "json" })
      .$type<Incident["provenance"]>()
      .notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.id] })],
);

/** Immutable local delivery envelope for retrying a Sibyl memory write. */
export const incidentMemoryBundles = sqliteTable(
  "incident_memory_bundles",
  {
    workspaceId: text("workspace_id").notNull(),
    incidentId: text("incident_id").notNull(),
    bundle: text("bundle", { mode: "json" }).$type<ScarMemoryBundle>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.incidentId] })],
);

/**
 * A SCAR tenant. Workspace identity is always resolved from the authenticated
 * server-side path context; it is never accepted as an authority-bearing JSON
 * value for an operational record.
 */
export const scarWorkspaces = sqliteTable("scar_workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["PERSONAL", "ORGANIZATION"] }).notNull(),
  status: text("status", { enum: ["ACTIVE", "SUSPENDED"] }).notNull(),
  createdAt: text("created_at").notNull(),
});

/** Ownership is deliberately distinct from operational and safety roles. */
export const scarWorkspaceMemberships = sqliteTable(
  "scar_workspace_memberships",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    membership: text("membership", { enum: ["OWNER", "MEMBER"] }).notNull(),
    status: text("status", { enum: ["ACTIVE", "REVOKED"] }).notNull(),
    addedBy: text("added_by").notNull(),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

/** Current explicit operational/safety role state, keyed to one workspace. */
export const scarWorkspaceRoleAssignments = sqliteTable(
  "scar_workspace_role_assignments",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", {
      enum: ["ADMIN", "OPERATOR", "APPROVER", "SAFETY_OFFICER"],
    })
      .$type<ScarRole>()
      .notNull(),
    status: text("status", { enum: ["ACTIVE", "REVOKED"] }).notNull(),
    assignedBy: text("assigned_by").notNull(),
    assignedAt: text("assigned_at").notNull(),
    revokedBy: text("revoked_by"),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId, table.role] }),
  ],
);

/** Append-only evidence for every role grant, regrant, and revocation. */
export const scarWorkspaceRoleAuditEvents = sqliteTable(
  "scar_workspace_role_audit_events",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", {
      enum: ["ADMIN", "OPERATOR", "APPROVER", "SAFETY_OFFICER"],
    })
      .$type<ScarRole>()
      .notNull(),
    change: text("change", { enum: ["ASSIGNED", "REVOKED"] }).notNull(),
    actorUserId: text("actor_user_id").notNull(),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.id] })],
);

/**
 * Public configuration metadata only. Private signing material remains in the
 * worker runtime and is resolved by the opaque executor key reference.
 */
export const scarWorkspaceExecutionConfigurations = sqliteTable(
  "scar_workspace_execution_configurations",
  {
    workspaceId: text("workspace_id").primaryKey(),
    status: text("status", { enum: ["DISABLED", "ENABLED"] }).notNull(),
    executorKeyReference: text("executor_key_reference"),
    chainId: integer("chain_id"),
    tokenAddress: text("token_address"),
    configuredBy: text("configured_by"),
    configuredAt: text("configured_at"),
  },
);

/** Historical single-organization role records, retained only for migration. */
export const scarHumanRoles = sqliteTable("scar_human_roles", {
  userId: text("user_id").primaryKey(),
  role: text("role", {
    enum: ["ADMIN", "OPERATOR", "APPROVER", "SAFETY_OFFICER"],
  }).$type<ScarRole>().notNull(),
  status: text("status", { enum: ["ACTIVE", "REVOKED"] }).notNull(),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
});

/** Hashed, revocable machine credentials; their secrets are never stored. */
export const scarAgentCredentials = sqliteTable("scar_agent_credentials", {
  workspaceId: text("workspace_id").notNull(),
  id: text("id").notNull(),
  agentId: text("agent_id").notNull(),
  secretHash: text("secret_hash").notNull(),
  allowedOperations: text("allowed_operations", { mode: "json" })
    .$type<AgentOperation[]>()
    .notNull(),
  status: text("status", { enum: ["ACTIVE", "REVOKED"] }).notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.id] }),
  uniqueIndex("scar_agent_credentials_workspace_secret_hash_unique").on(
    table.workspaceId,
    table.secretHash,
  ),
]);

/** Append-only HTTP boundary audit; no request bodies or secrets are retained. */
export const scarHttpAuditEvents = sqliteTable("scar_http_audit_events", {
  workspaceId: text("workspace_id").notNull(),
  id: text("id").notNull(),
  /** Preserved only while pre-workspace audit records are retained. */
  legacyOrganizationId: text("legacy_organization_id"),
  requestId: text("request_id").notNull(),
  principalType: text("principal_type", { enum: ["HUMAN", "AGENT"] }).notNull(),
  principalId: text("principal_id").notNull(),
  operation: text("operation").$type<HttpOperation>().notNull(),
  actionId: text("action_id"),
  incidentId: text("incident_id"),
  outcome: text("outcome", {
    enum: ["ACCEPTED", "COMPLETED", "REJECTED", "FAILED"],
  }).notNull(),
  statusCode: integer("status_code").notNull(),
  occurredAt: text("occurred_at").notNull(),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.id] })]);

/** Atomic fixed-window counters at the authenticated API boundary. */
export const scarHttpRateLimitBuckets = sqliteTable(
  "scar_http_rate_limit_buckets",
  {
    workspaceId: text("workspace_id").notNull(),
    principalId: text("principal_id").notNull(),
    operation: text("operation").$type<HttpOperation>().notNull(),
    windowStartedAt: text("window_started_at").notNull(),
    count: integer("count").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.workspaceId,
        table.principalId,
        table.operation,
        table.windowStartedAt,
      ],
    }),
  ],
);

export const authorizations = sqliteTable(
  "authorizations",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    actionId: text("action_id").notNull(),
    decision: text("decision", { enum: ["ALLOW", "REVIEW", "BLOCK"] }).notNull(),
    reasonCode: text("reason_code").notNull(),
    rationale: text("rationale").notNull(),
    evidence: text("evidence", { mode: "json" })
      .$type<EvidenceReference[]>()
      .notNull(),
    provenance: text("provenance", { mode: "json" })
      .$type<AuthorizationRecord["provenance"]>()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    uniqueIndex("authorizations_workspace_action_unique").on(
      table.workspaceId,
      table.actionId,
    ),
  ],
);

export const approvals = sqliteTable(
  "approvals",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(),
    actionId: text("action_id").notNull(),
    authorizationId: text("authorization_id").notNull(),
    approvedBy: text("approved_by").notNull(),
    approvedAt: text("approved_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.id] }),
    uniqueIndex("approvals_action_authorization_unique").on(
      table.workspaceId,
      table.actionId,
      table.authorizationId,
    ),
  ],
);

export const executions = sqliteTable(
  "executions",
  {
    workspaceId: text("workspace_id").notNull(),
    actionId: text("action_id").notNull(),
    id: text("id").notNull(),
    authorizationId: text("authorization_id").notNull(),
    status: text("status", {
      enum: ["PENDING", "SUCCEEDED", "FAILED"],
    }).notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    externalReference: text("external_reference"),
    errorCode: text("error_code"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.actionId] }),
  ],
);

export const baseExecutionReceipts = sqliteTable(
  "base_execution_receipts",
  {
    workspaceId: text("workspace_id").notNull(),
    actionId: text("action_id").notNull(),
    agentId: text("agent_id").notNull(),
    authorizationId: text("authorization_id").notNull(),
    network: text("network", { enum: ["BASE_SEPOLIA"] }).notNull(),
    chainId: integer("chain_id").notNull(),
    tokenAddress: text("token_address").notNull(),
    recipient: text("recipient").notNull(),
    amountAtomic: text("amount_atomic").notNull(),
    transactionHash: text("transaction_hash").notNull(),
    blockNumber: text("block_number").notNull(),
    outcome: text("outcome", { enum: ["CONFIRMED", "REVERTED"] }).notNull(),
    submittedAt: text("submitted_at").notNull(),
    resolvedAt: text("resolved_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.actionId] })],
);
