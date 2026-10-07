import { and, asc, eq, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "@/db/schema";
import {
  agentCredentialRecordSchema,
  addWorkspaceMemberSchema,
  assignWorkspaceRoleSchema,
  createWorkspaceForOwnerSchema,
  httpAuditRecordSchema,
  rateLimitClaimSchema,
  revokeWorkspaceMemberSchema,
  revokeWorkspaceRoleSchema,
  workspaceExecutionConfigurationSchema,
  workspaceMembershipRecordSchema,
  workspaceRecordSchema,
  workspaceRoleAssignmentSchema,
  workspaceRoleAuditRecordSchema,
  type AgentCredentialRecord,
  type HttpAuditRecord,
  type ScarRole,
  type WorkspaceExecutionConfiguration,
  type WorkspaceMembershipRecord,
  type WorkspaceRecord,
  type WorkspaceRoleAuditRecord,
} from "./contracts";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

export class D1ScarSecurityRepository {
  private readonly db: DrizzleDb;

  constructor(dbOrBinding: DrizzleDb | D1Database) {
    if (
      "prepare" in dbOrBinding &&
      typeof (dbOrBinding as D1Database).prepare === "function"
    ) {
      this.db = drizzle(dbOrBinding as D1Database, { schema });
    } else {
      this.db = dbOrBinding as DrizzleDb;
    }
  }

  /**
   * D1 executes a batch atomically. This creates the tenant, the sole initial
   * OWNER membership, and an explicit disabled execution configuration as one
   * unit. It intentionally creates no ADMIN/OPERATOR/APPROVER/SAFETY role.
   */
  async createWorkspaceForOwner(input: unknown): Promise<{
    workspace: WorkspaceRecord;
    membership: WorkspaceMembershipRecord;
    executionConfiguration: WorkspaceExecutionConfiguration;
  }> {
    const request = createWorkspaceForOwnerSchema.parse(input);
    const existing = await this.findWorkspace(request.id);
    if (existing) throw new Error(`Workspace ${request.id} already exists`);

    const workspace: WorkspaceRecord = {
      id: request.id,
      name: request.name,
      kind: request.kind,
      status: "ACTIVE",
      createdAt: request.createdAt,
    };
    const membership: WorkspaceMembershipRecord = {
      workspaceId: request.id,
      userId: request.ownerUserId,
      membership: "OWNER",
      status: "ACTIVE",
      addedBy: request.ownerUserId,
      createdAt: request.createdAt,
    };
    const executionConfiguration: WorkspaceExecutionConfiguration = {
      workspaceId: request.id,
      status: "DISABLED",
    };

    try {
      await this.db.batch([
        this.db.insert(schema.scarWorkspaces).values(workspace),
        this.db.insert(schema.scarWorkspaceMemberships).values({
          ...membership,
          revokedAt: null,
        }),
        this.db.insert(schema.scarWorkspaceExecutionConfigurations).values({
          ...executionConfiguration,
          executorKeyReference: null,
          chainId: null,
          tokenAddress: null,
          configuredBy: null,
          configuredAt: null,
        }),
      ]);
    } catch (error) {
      if (await this.findWorkspace(request.id)) {
        throw new Error(`Workspace ${request.id} already exists`);
      }
      throw error;
    }

    return { workspace, membership, executionConfiguration };
  }

  async findWorkspace(workspaceId: string): Promise<WorkspaceRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.scarWorkspaces)
      .where(eq(schema.scarWorkspaces.id, workspaceId))
      .limit(1);
    return rows.length === 0 ? null : workspaceRecordSchema.parse(rows[0]);
  }

  async findActiveWorkspaceMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipRecord | null> {
    const rows = await this.db
      .select({
        workspaceId: schema.scarWorkspaceMemberships.workspaceId,
        userId: schema.scarWorkspaceMemberships.userId,
        membership: schema.scarWorkspaceMemberships.membership,
        status: schema.scarWorkspaceMemberships.status,
        addedBy: schema.scarWorkspaceMemberships.addedBy,
        createdAt: schema.scarWorkspaceMemberships.createdAt,
        revokedAt: schema.scarWorkspaceMemberships.revokedAt,
      })
      .from(schema.scarWorkspaceMemberships)
      .innerJoin(
        schema.scarWorkspaces,
        and(
          eq(
            schema.scarWorkspaces.id,
            schema.scarWorkspaceMemberships.workspaceId,
          ),
          eq(schema.scarWorkspaces.status, "ACTIVE"),
        ),
      )
      .where(
        and(
          eq(schema.scarWorkspaceMemberships.workspaceId, workspaceId),
          eq(schema.scarWorkspaceMemberships.userId, userId),
          eq(schema.scarWorkspaceMemberships.status, "ACTIVE"),
        ),
      )
      .limit(1);
    return rows.length === 0
      ? null
      : workspaceMembershipRecordSchema.parse(rows[0]);
  }

  async addWorkspaceMember(input: unknown): Promise<WorkspaceMembershipRecord> {
    const member = addWorkspaceMemberSchema.parse(input);
    const workspace = await this.findWorkspace(member.workspaceId);
    if (!workspace || workspace.status !== "ACTIVE") {
      throw new Error(`Workspace ${member.workspaceId} is unavailable`);
    }
    const existing = await this.db
      .select()
      .from(schema.scarWorkspaceMemberships)
      .where(
        and(
          eq(schema.scarWorkspaceMemberships.workspaceId, member.workspaceId),
          eq(schema.scarWorkspaceMemberships.userId, member.userId),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new Error(
        `User ${member.userId} is already a member of workspace ${member.workspaceId}`,
      );
    }
    const record: WorkspaceMembershipRecord = {
      ...member,
      status: "ACTIVE",
    };
    await this.db.insert(schema.scarWorkspaceMemberships).values({
      ...record,
      revokedAt: null,
    });
    return record;
  }

  /**
   * Revocation deliberately applies only to MEMBER records. An OWNER cannot
   * remove itself or another OWNER through this path, so it cannot strand a
   * workspace without an owner. Existing role records are historical state;
   * every authorization path first requires this active membership.
   */
  async revokeWorkspaceMember(input: unknown): Promise<WorkspaceMembershipRecord> {
    const request = revokeWorkspaceMemberSchema.parse(input);
    const rows = await this.db
      .update(schema.scarWorkspaceMemberships)
      .set({ status: "REVOKED", revokedAt: request.revokedAt })
      .where(
        and(
          eq(schema.scarWorkspaceMemberships.workspaceId, request.workspaceId),
          eq(schema.scarWorkspaceMemberships.userId, request.userId),
          eq(schema.scarWorkspaceMemberships.membership, "MEMBER"),
          eq(schema.scarWorkspaceMemberships.status, "ACTIVE"),
        ),
      )
      .returning();
    if (rows.length !== 1) {
      throw new Error(
        `Active member ${request.userId} is unavailable in workspace ${request.workspaceId}`,
      );
    }
    return workspaceMembershipRecordSchema.parse(rows[0]);
  }

  async findWorkspaceExecutionConfiguration(
    workspaceId: string,
  ): Promise<WorkspaceExecutionConfiguration | null> {
    const rows = await this.db
      .select()
      .from(schema.scarWorkspaceExecutionConfigurations)
      .where(
        eq(
          schema.scarWorkspaceExecutionConfigurations.workspaceId,
          workspaceId,
        ),
      )
      .limit(1);
    return rows.length === 0
      ? null
      : workspaceExecutionConfigurationSchema.parse(rows[0]);
  }

  async findActiveHumanRoles(
    workspaceId: string,
    userId: string,
  ): Promise<ScarRole[]> {
    const rows = await this.db
      .select({ role: schema.scarWorkspaceRoleAssignments.role })
      .from(schema.scarWorkspaceRoleAssignments)
      .innerJoin(
        schema.scarWorkspaceMemberships,
        and(
          eq(
            schema.scarWorkspaceMemberships.workspaceId,
            schema.scarWorkspaceRoleAssignments.workspaceId,
          ),
          eq(
            schema.scarWorkspaceMemberships.userId,
            schema.scarWorkspaceRoleAssignments.userId,
          ),
          eq(schema.scarWorkspaceMemberships.status, "ACTIVE"),
        ),
      )
      .where(
        and(
          eq(schema.scarWorkspaceRoleAssignments.workspaceId, workspaceId),
          eq(schema.scarWorkspaceRoleAssignments.userId, userId),
          eq(schema.scarWorkspaceRoleAssignments.status, "ACTIVE"),
        ),
      );
    return rows.map((row) => row.role as ScarRole).sort();
  }

  async assignWorkspaceRole(input: unknown): Promise<WorkspaceRoleAuditRecord> {
    const request = assignWorkspaceRoleSchema.parse(input);
    const membership = await this.findActiveWorkspaceMembership(
      request.workspaceId,
      request.userId,
    );
    if (!membership) {
      throw new Error(
        `User ${request.userId} is not an active member of workspace ${request.workspaceId}`,
      );
    }
    const existing = await this.findWorkspaceRoleAssignment(
      request.workspaceId,
      request.userId,
      request.role,
    );
    if (existing?.status === "ACTIVE") {
      throw new Error(
        `Role ${request.role} is already active for user ${request.userId} in workspace ${request.workspaceId}`,
      );
    }
    const assignment = workspaceRoleAssignmentSchema.parse({
      workspaceId: request.workspaceId,
      userId: request.userId,
      role: request.role,
      status: "ACTIVE",
      assignedBy: request.assignedBy,
      assignedAt: request.occurredAt,
      revokedBy: null,
      revokedAt: null,
    });
    const audit = workspaceRoleAuditRecordSchema.parse({
      id: request.id,
      workspaceId: request.workspaceId,
      userId: request.userId,
      role: request.role,
      change: "ASSIGNED",
      actorUserId: request.assignedBy,
      occurredAt: request.occurredAt,
    });
    await this.db.batch([
      this.db
        .insert(schema.scarWorkspaceRoleAssignments)
        .values(assignment)
        .onConflictDoUpdate({
          target: [
            schema.scarWorkspaceRoleAssignments.workspaceId,
            schema.scarWorkspaceRoleAssignments.userId,
            schema.scarWorkspaceRoleAssignments.role,
          ],
          set: assignment,
        }),
      this.db.insert(schema.scarWorkspaceRoleAuditEvents).values(audit),
    ]);
    return audit;
  }

  async revokeWorkspaceRole(input: unknown): Promise<WorkspaceRoleAuditRecord> {
    const request = revokeWorkspaceRoleSchema.parse(input);
    const existing = await this.findWorkspaceRoleAssignment(
      request.workspaceId,
      request.userId,
      request.role,
    );
    if (!existing || existing.status !== "ACTIVE") {
      throw new Error(
        `Role ${request.role} is not active for user ${request.userId} in workspace ${request.workspaceId}`,
      );
    }
    const audit = workspaceRoleAuditRecordSchema.parse({
      id: request.id,
      workspaceId: request.workspaceId,
      userId: request.userId,
      role: request.role,
      change: "REVOKED",
      actorUserId: request.revokedBy,
      occurredAt: request.occurredAt,
    });
    await this.db.batch([
      this.db
        .update(schema.scarWorkspaceRoleAssignments)
        .set({
          status: "REVOKED",
          revokedBy: request.revokedBy,
          revokedAt: request.occurredAt,
        })
        .where(
          and(
            eq(
              schema.scarWorkspaceRoleAssignments.workspaceId,
              request.workspaceId,
            ),
            eq(schema.scarWorkspaceRoleAssignments.userId, request.userId),
            eq(schema.scarWorkspaceRoleAssignments.role, request.role),
            eq(schema.scarWorkspaceRoleAssignments.status, "ACTIVE"),
          ),
        ),
      this.db.insert(schema.scarWorkspaceRoleAuditEvents).values(audit),
    ]);
    return audit;
  }

  async listWorkspaceRoleAudit(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceRoleAuditRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.scarWorkspaceRoleAuditEvents)
      .where(
        and(
          eq(schema.scarWorkspaceRoleAuditEvents.workspaceId, workspaceId),
          eq(schema.scarWorkspaceRoleAuditEvents.userId, userId),
        ),
      )
      .orderBy(asc(schema.scarWorkspaceRoleAuditEvents.occurredAt));
    return rows.map((row) => workspaceRoleAuditRecordSchema.parse(row));
  }

  private async findWorkspaceRoleAssignment(
    workspaceId: string,
    userId: string,
    role: ScarRole,
  ) {
    const rows = await this.db
      .select()
      .from(schema.scarWorkspaceRoleAssignments)
      .where(
        and(
          eq(schema.scarWorkspaceRoleAssignments.workspaceId, workspaceId),
          eq(schema.scarWorkspaceRoleAssignments.userId, userId),
          eq(schema.scarWorkspaceRoleAssignments.role, role),
        ),
      )
      .limit(1);
    return rows.length === 0
      ? null
      : workspaceRoleAssignmentSchema.parse(rows[0]);
  }

  async saveAgentCredential(input: unknown): Promise<AgentCredentialRecord> {
    const credential = agentCredentialRecordSchema.parse(input);
    await this.db.insert(schema.scarAgentCredentials).values({
      workspaceId: credential.workspaceId,
      id: credential.id,
      agentId: credential.agentId,
      secretHash: credential.secretHash,
      allowedOperations: credential.allowedOperations,
      status: credential.status,
      createdAt: credential.createdAt,
      expiresAt: credential.expiresAt,
      revokedAt: credential.revokedAt ?? null,
    });
    return credential;
  }

  async findWorkspaceAgentCredential(
    workspaceId: string,
    id: string,
  ): Promise<AgentCredentialRecord | null> {
    const rows = await this.db
      .select({
        workspaceId: schema.scarAgentCredentials.workspaceId,
        id: schema.scarAgentCredentials.id,
        agentId: schema.scarAgentCredentials.agentId,
        secretHash: schema.scarAgentCredentials.secretHash,
        allowedOperations: schema.scarAgentCredentials.allowedOperations,
        status: schema.scarAgentCredentials.status,
        createdAt: schema.scarAgentCredentials.createdAt,
        expiresAt: schema.scarAgentCredentials.expiresAt,
        revokedAt: schema.scarAgentCredentials.revokedAt,
      })
      .from(schema.scarAgentCredentials)
      .innerJoin(
        schema.scarWorkspaces,
        and(
          eq(
            schema.scarWorkspaces.id,
            schema.scarAgentCredentials.workspaceId,
          ),
          eq(schema.scarWorkspaces.status, "ACTIVE"),
        ),
      )
      .where(
        and(
          eq(schema.scarAgentCredentials.workspaceId, workspaceId),
          eq(schema.scarAgentCredentials.id, id),
        ),
      )
      .limit(1);
    return rows.length === 0 ? null : agentCredentialRecordSchema.parse(rows[0]);
  }

  async revokeWorkspaceAgentCredential(
    workspaceId: string,
    id: string,
    revokedAt: string,
  ): Promise<void> {
    await this.db
      .update(schema.scarAgentCredentials)
      .set({ status: "REVOKED", revokedAt })
      .where(
        and(
          eq(schema.scarAgentCredentials.workspaceId, workspaceId),
          eq(schema.scarAgentCredentials.id, id),
          eq(schema.scarAgentCredentials.status, "ACTIVE"),
        ),
      );
  }

  /**
   * This is intentionally server-administration only: it stores no key and is
   * not surfaced by self-service HTTP routes. A runtime must still recognize
   * the opaque key reference before an adapter is reachable.
   */
  async saveWorkspaceExecutionConfiguration(
    input: unknown,
  ): Promise<WorkspaceExecutionConfiguration> {
    const configuration = workspaceExecutionConfigurationSchema.parse(input);
    await this.db
      .insert(schema.scarWorkspaceExecutionConfigurations)
      .values({
        ...configuration,
        executorKeyReference: configuration.executorKeyReference ?? null,
        chainId: configuration.chainId ?? null,
        tokenAddress: configuration.tokenAddress ?? null,
        configuredBy: configuration.configuredBy ?? null,
        configuredAt: configuration.configuredAt ?? null,
      })
      .onConflictDoUpdate({
        target: schema.scarWorkspaceExecutionConfigurations.workspaceId,
        set: {
          status: configuration.status,
          executorKeyReference: configuration.executorKeyReference ?? null,
          chainId: configuration.chainId ?? null,
          tokenAddress: configuration.tokenAddress ?? null,
          configuredBy: configuration.configuredBy ?? null,
          configuredAt: configuration.configuredAt ?? null,
        },
      });
    return configuration;
  }

  async claimRateLimit(input: unknown): Promise<boolean> {
    const claim = rateLimitClaimSchema.parse(input);
    const rows = await this.db
      .insert(schema.scarHttpRateLimitBuckets)
      .values({
        workspaceId: claim.workspaceId,
        principalId: claim.principalId,
        operation: claim.operation,
        windowStartedAt: claim.windowStartedAt,
        count: 1,
      })
      .onConflictDoUpdate({
        target: [
          schema.scarHttpRateLimitBuckets.workspaceId,
          schema.scarHttpRateLimitBuckets.principalId,
          schema.scarHttpRateLimitBuckets.operation,
          schema.scarHttpRateLimitBuckets.windowStartedAt,
        ],
        set: { count: sql`${schema.scarHttpRateLimitBuckets.count} + 1` },
        where: lt(schema.scarHttpRateLimitBuckets.count, claim.limit),
      })
      .returning({ count: schema.scarHttpRateLimitBuckets.count });
    return rows.length === 1;
  }

  async appendHttpAudit(input: unknown): Promise<HttpAuditRecord> {
    const record = httpAuditRecordSchema.parse(input);
    await this.db.insert(schema.scarHttpAuditEvents).values({
      id: record.id,
      workspaceId: record.workspaceId,
      legacyOrganizationId: null,
      requestId: record.requestId,
      principalType: record.principalType,
      principalId: record.principalId,
      operation: record.operation,
      actionId: record.actionId ?? null,
      incidentId: record.incidentId ?? null,
      outcome: record.outcome,
      statusCode: record.statusCode,
      occurredAt: record.occurredAt,
    });
    return record;
  }
}
