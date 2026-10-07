import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "@/db/schema";
import {
  baseExecutionReceiptSchema,
  type BaseExecutionReceipt,
} from "./base-execution";
import {
  agentSchema,
  approvalRecordSchema,
  authorizationRecordSchema,
  completedExecutionRecordSchema,
  executionRecordSchema,
  identifierSchema,
  incidentQuerySchema,
  incidentSchema,
  pendingExecutionRecordSchema,
  protectedActionSchema,
  type Agent,
  type ApprovalRecord,
  type AuthorizationRecord,
  type CompletedExecutionRecord,
  type ExecutionRecord,
  type Incident,
  type IncidentQuery,
  type PendingExecutionRecord,
  type ProtectedAction,
} from "./domain";
import type { ScarRepository } from "./repository";
import {
  scarMemoryBundleSchema,
  type ScarMemoryBundle,
} from "./sibyl-contract";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

export class D1ScarRepository implements ScarRepository {
  readonly durability = "DURABLE" as const;
  private readonly db: DrizzleDb;
  readonly workspaceId: string;

  constructor(dbOrBinding: DrizzleDb | D1Database, workspaceId: string) {
    this.workspaceId = identifierSchema.parse(workspaceId);
    if (
      "prepare" in dbOrBinding &&
      typeof (dbOrBinding as D1Database).prepare === "function"
    ) {
      this.db = drizzle(dbOrBinding as D1Database, { schema });
    } else {
      this.db = dbOrBinding as DrizzleDb;
    }
  }

  async saveAgent(input: unknown): Promise<Agent> {
    const agent = agentSchema.parse(input);
    const existing = await this.findAgentById(agent.id);
    if (existing) {
      throw new Error(`Agent ${agent.id} already exists`);
    }

    try {
      await this.db.insert(schema.agents).values({
        workspaceId: this.workspaceId,
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status,
        permissions: agent.permissions,
      });
    } catch {
      throw new Error(`Agent ${agent.id} already exists`);
    }

    const saved = await this.findAgentById(agent.id);
    if (!saved) throw new Error(`Failed to persist agent ${agent.id}`);
    return saved;
  }

  async findAgentById(id: string): Promise<Agent | null> {
    const rows = await this.db
      .select()
      .from(schema.agents)
      .where(
        and(
          eq(schema.agents.workspaceId, this.workspaceId),
          eq(schema.agents.id, id),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;
    return agentSchema.parse(withoutWorkspaceScope(rows[0]));
  }

  async saveAction(input: unknown): Promise<ProtectedAction> {
    const action = protectedActionSchema.parse(input);
    const existing = await this.findActionById(action.id);
    if (existing) {
      throw new Error(`Action ${action.id} already exists`);
    }

    try {
      await this.db.insert(schema.protectedActions).values({
        workspaceId: this.workspaceId,
        id: action.id,
        agentId: action.agentId,
        actionType: action.actionType,
        amountAtomic: action.amountAtomic,
        entityId: action.entityId,
        recipient: action.recipient,
        chainId: action.chainId,
        proposedAt: action.proposedAt,
      });
    } catch {
      throw new Error(`Action ${action.id} already exists`);
    }

    const saved = await this.findActionById(action.id);
    if (!saved) throw new Error(`Failed to persist action ${action.id}`);
    return saved;
  }

  async findActionById(id: string): Promise<ProtectedAction | null> {
    const rows = await this.db
      .select()
      .from(schema.protectedActions)
      .where(
        and(
          eq(schema.protectedActions.workspaceId, this.workspaceId),
          eq(schema.protectedActions.id, id),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;
    return protectedActionSchema.parse(withoutWorkspaceScope(rows[0]));
  }

  async appendIncident(input: unknown): Promise<Incident> {
    const incident = incidentSchema.parse(input);
    const existing = await this.findIncidentById(incident.id);
    if (existing) {
      throw new Error(`Incident ${incident.id} already exists`);
    }

    try {
      await this.db.insert(schema.incidents).values({
        workspaceId: this.workspaceId,
        id: incident.id,
        sourceAgentId: incident.sourceAgentId,
        relatedActionId: incident.relatedActionId,
        entityId: incident.entityId,
        actionType: incident.actionType,
        context: incident.context,
        outcome: incident.outcome,
        severity: incident.severity,
        reason: incident.reason,
        mitigation: incident.mitigation,
        evidence: incident.evidence,
        provenance: incident.provenance,
        createdAt: incident.createdAt,
      });
    } catch {
      throw new Error(`Incident ${incident.id} already exists`);
    }

    const saved = await this.findIncidentById(incident.id);
    if (!saved) throw new Error(`Failed to persist incident ${incident.id}`);
    return saved;
  }

  async findIncidentById(id: string): Promise<Incident | null> {
    const rows = await this.db
      .select()
      .from(schema.incidents)
      .where(
        and(
          eq(schema.incidents.workspaceId, this.workspaceId),
          eq(schema.incidents.id, id),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;
    return incidentSchema.parse(withoutWorkspaceScope(rows[0]));
  }

  async findIncidents(query: IncidentQuery): Promise<Incident[]> {
    const parsedQuery = incidentQuerySchema.parse(query);
    const conditions = [eq(schema.incidents.workspaceId, this.workspaceId)];

    if (parsedQuery.entityId) {
      conditions.push(eq(schema.incidents.entityId, parsedQuery.entityId));
    }
    if (parsedQuery.actionType) {
      conditions.push(eq(schema.incidents.actionType, parsedQuery.actionType));
    }

    const rows =
      conditions.length > 0
        ? await this.db
            .select()
            .from(schema.incidents)
            .where(and(...conditions))
        : await this.db
            .select()
            .from(schema.incidents)
            .where(eq(schema.incidents.workspaceId, this.workspaceId));

    return rows.map((row) => incidentSchema.parse(withoutWorkspaceScope(row)));
  }

  async findIncidentsForAction(actionId: string): Promise<Incident[]> {
    const rows = await this.db
      .select()
      .from(schema.incidents)
      .where(
        and(
          eq(schema.incidents.workspaceId, this.workspaceId),
          eq(schema.incidents.relatedActionId, actionId),
        ),
      );
    return rows.map((row) => incidentSchema.parse(withoutWorkspaceScope(row)));
  }

  async appendIncidentMemoryBundle(input: unknown): Promise<ScarMemoryBundle> {
    const bundle = scarMemoryBundleSchema.parse(input);
    const existing = await this.findIncidentMemoryBundle(bundle.incident.id);
    if (existing) {
      throw new Error(
        `Incident memory bundle for ${bundle.incident.id} already exists`,
      );
    }

    try {
      await this.db.insert(schema.incidentMemoryBundles).values({
        workspaceId: this.workspaceId,
        incidentId: bundle.incident.id,
        bundle,
      });
    } catch {
      throw new Error(
        `Incident memory bundle for ${bundle.incident.id} already exists`,
      );
    }

    const saved = await this.findIncidentMemoryBundle(bundle.incident.id);
    if (!saved) {
      throw new Error(
        `Failed to persist incident memory bundle for ${bundle.incident.id}`,
      );
    }
    return saved;
  }

  async findIncidentMemoryBundle(
    incidentId: string,
  ): Promise<ScarMemoryBundle | null> {
    const rows = await this.db
      .select()
      .from(schema.incidentMemoryBundles)
      .where(
        and(
          eq(schema.incidentMemoryBundles.workspaceId, this.workspaceId),
          eq(schema.incidentMemoryBundles.incidentId, incidentId),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;
    return scarMemoryBundleSchema.parse(rows[0].bundle);
  }

  async saveAuthorization(input: unknown): Promise<AuthorizationRecord> {
    const authorization = authorizationRecordSchema.parse(input);

    const existingForAction = await this.findAuthorizationForAction(
      authorization.actionId,
    );
    if (existingForAction) {
      throw new Error(
        `Authorization for action ${authorization.actionId} already exists`,
      );
    }

    const existingById = await this.db
      .select({ id: schema.authorizations.id })
      .from(schema.authorizations)
      .where(
        and(
          eq(schema.authorizations.workspaceId, this.workspaceId),
          eq(schema.authorizations.id, authorization.id),
        ),
      )
      .limit(1);

    if (existingById.length > 0) {
      throw new Error(
        `Authorization for action ${authorization.actionId} already exists`,
      );
    }

    try {
      await this.db.insert(schema.authorizations).values({
        workspaceId: this.workspaceId,
        id: authorization.id,
        actionId: authorization.actionId,
        decision: authorization.decision,
        reasonCode: authorization.reasonCode,
        rationale: authorization.rationale,
        evidence: authorization.evidence,
        provenance: authorization.provenance,
      });
    } catch {
      throw new Error(
        `Authorization for action ${authorization.actionId} already exists`,
      );
    }

    const saved = await this.findAuthorizationForAction(authorization.actionId);
    if (!saved) {
      throw new Error(
        `Failed to persist authorization for action ${authorization.actionId}`,
      );
    }
    return saved;
  }

  async findAuthorizationForAction(
    actionId: string,
  ): Promise<AuthorizationRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.authorizations)
      .where(
        and(
          eq(schema.authorizations.workspaceId, this.workspaceId),
          eq(schema.authorizations.actionId, actionId),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;
    return authorizationRecordSchema.parse(withoutWorkspaceScope(rows[0]));
  }

  async saveApproval(input: unknown): Promise<ApprovalRecord> {
    const approval = approvalRecordSchema.parse(input);
    const existing = await this.findApprovalById(approval.id);
    if (existing) {
      throw new Error(`Approval ${approval.id} already exists`);
    }

    try {
      await this.db.insert(schema.approvals).values({
        workspaceId: this.workspaceId,
        id: approval.id,
        actionId: approval.actionId,
        authorizationId: approval.authorizationId,
        approvedBy: approval.approvedBy,
        approvedAt: approval.approvedAt,
      });
    } catch {
      throw new Error(`Approval ${approval.id} already exists`);
    }

    const saved = await this.findApprovalById(approval.id);
    if (!saved) throw new Error(`Failed to persist approval ${approval.id}`);
    return saved;
  }

  async findApprovalById(id: string): Promise<ApprovalRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.workspaceId, this.workspaceId),
          eq(schema.approvals.id, id),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;
    return approvalRecordSchema.parse(withoutWorkspaceScope(rows[0]));
  }

  async findApprovalForAction(
    actionId: string,
  ): Promise<ApprovalRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.workspaceId, this.workspaceId),
          eq(schema.approvals.actionId, actionId),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;
    return approvalRecordSchema.parse(withoutWorkspaceScope(rows[0]));
  }

  async claimExecution(input: unknown): Promise<PendingExecutionRecord | null> {
    const execution = pendingExecutionRecordSchema.parse(input);

    const insertedRows = await this.db
      .insert(schema.executions)
      .values({
        workspaceId: this.workspaceId,
        id: execution.id,
        actionId: execution.actionId,
        authorizationId: execution.authorizationId,
        status: execution.status,
        startedAt: execution.startedAt,
      })
      .onConflictDoNothing({
        target: [schema.executions.workspaceId, schema.executions.actionId],
      })
      .returning();

    if (insertedRows.length === 0) {
      return null;
    }

    const row = insertedRows[0];
    return pendingExecutionRecordSchema.parse({
      id: row.id,
      actionId: row.actionId,
      authorizationId: row.authorizationId,
      status: "PENDING",
      startedAt: row.startedAt,
    });
  }

  async completeExecution(input: unknown): Promise<CompletedExecutionRecord> {
    const completion = completedExecutionRecordSchema.parse(input);

    const updateValues =
      completion.status === "SUCCEEDED"
        ? {
            status: completion.status,
            completedAt: completion.completedAt,
            externalReference: completion.externalReference,
            errorCode: null,
          }
        : {
            status: completion.status,
            completedAt: completion.completedAt,
            externalReference: null,
            errorCode: completion.errorCode,
          };

    const updatedRows = await this.db
      .update(schema.executions)
      .set(updateValues)
      .where(
        and(
          eq(schema.executions.workspaceId, this.workspaceId),
          eq(schema.executions.actionId, completion.actionId),
          eq(schema.executions.id, completion.id),
          eq(schema.executions.authorizationId, completion.authorizationId),
          eq(schema.executions.status, "PENDING"),
        ),
      )
      .returning();

    if (updatedRows.length === 0) {
      throw new Error(
        `Execution ${completion.id} is not the active pending execution`,
      );
    }

    const row = updatedRows[0];
    if (row.status === "SUCCEEDED") {
      return completedExecutionRecordSchema.parse({
        id: row.id,
        actionId: row.actionId,
        authorizationId: row.authorizationId,
        status: "SUCCEEDED",
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        externalReference: row.externalReference,
      });
    }

    return completedExecutionRecordSchema.parse({
      id: row.id,
      actionId: row.actionId,
      authorizationId: row.authorizationId,
      status: "FAILED",
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      errorCode: row.errorCode,
    });
  }

  async findExecutionForAction(
    actionId: string,
  ): Promise<ExecutionRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.executions)
      .where(
        and(
          eq(schema.executions.workspaceId, this.workspaceId),
          eq(schema.executions.actionId, actionId),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0];

    if (row.status === "PENDING") {
      return pendingExecutionRecordSchema.parse({
        id: row.id,
        actionId: row.actionId,
        authorizationId: row.authorizationId,
        status: "PENDING",
        startedAt: row.startedAt,
      });
    }

    if (row.status === "SUCCEEDED") {
      return completedExecutionRecordSchema.parse({
        id: row.id,
        actionId: row.actionId,
        authorizationId: row.authorizationId,
        status: "SUCCEEDED",
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        externalReference: row.externalReference,
      });
    }

    return completedExecutionRecordSchema.parse({
      id: row.id,
      actionId: row.actionId,
      authorizationId: row.authorizationId,
      status: "FAILED",
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      errorCode: row.errorCode,
    });
  }

  async saveBaseExecutionReceipt(
    input: unknown,
  ): Promise<BaseExecutionReceipt> {
    const receipt = baseExecutionReceiptSchema.parse(input);

    await this.db
      .insert(schema.baseExecutionReceipts)
      .values({
        workspaceId: this.workspaceId,
        actionId: receipt.actionId,
        agentId: receipt.agentId,
        authorizationId: receipt.authorizationId,
        network: receipt.network,
        chainId: receipt.chainId,
        tokenAddress: receipt.tokenAddress,
        recipient: receipt.recipient,
        amountAtomic: receipt.amountAtomic,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        outcome: receipt.outcome,
        submittedAt: receipt.submittedAt,
        resolvedAt: receipt.resolvedAt,
      })
      .onConflictDoUpdate({
        target: [
          schema.baseExecutionReceipts.workspaceId,
          schema.baseExecutionReceipts.actionId,
        ],
        set: {
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          outcome: receipt.outcome,
          resolvedAt: receipt.resolvedAt,
        },
      });

    const saved = await this.findBaseExecutionReceiptForAction(receipt.actionId);
    if (!saved) {
      throw new Error(
        `Failed to persist base execution receipt for action ${receipt.actionId}`,
      );
    }
    return saved;
  }

  async findBaseExecutionReceiptForAction(
    actionId: string,
  ): Promise<BaseExecutionReceipt | null> {
    const rows = await this.db
      .select()
      .from(schema.baseExecutionReceipts)
      .where(
        and(
          eq(schema.baseExecutionReceipts.workspaceId, this.workspaceId),
          eq(schema.baseExecutionReceipts.actionId, actionId),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;
    return baseExecutionReceiptSchema.parse(withoutWorkspaceScope(rows[0]));
  }
}

/** Domain records intentionally exclude the server-resolved workspace scope. */
function withoutWorkspaceScope<T extends { workspaceId?: unknown }>(row: T) {
  const { workspaceId: _workspaceId, ...record } = row;
  return record;
}
