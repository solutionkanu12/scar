import {
  agentSchema,
  approvalRecordSchema,
  authorizationRecordSchema,
  completedExecutionRecordSchema,
  incidentQuerySchema,
  incidentSchema,
  identifierSchema,
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

export class VolatileScarRepository implements ScarRepository {
  readonly durability = "VOLATILE_PROCESS" as const;
  /** Test/dev scope; production composition always uses D1 with a required ID. */
  readonly workspaceId: string;

  private readonly agents = new Map<string, Agent>();
  private readonly actions = new Map<string, ProtectedAction>();
  private readonly incidents = new Map<string, Incident>();
  private readonly incidentMemoryBundles = new Map<string, ScarMemoryBundle>();
  private readonly authorizations = new Map<string, AuthorizationRecord>();
  private readonly authorizationIds = new Set<string>();
  private readonly approvals = new Map<string, ApprovalRecord>();
  private readonly approvalIdsByAction = new Map<string, string>();
  private readonly executions = new Map<string, ExecutionRecord>();

  constructor(workspaceId = "workspace:volatile-test") {
    this.workspaceId = identifierSchema.parse(workspaceId);
  }

  async saveAgent(input: unknown): Promise<Agent> {
    const agent = agentSchema.parse(input);
    this.assertAbsent(this.agents, agent.id, "Agent");
    return this.store(this.agents, agent.id, agent);
  }

  async findAgentById(id: string): Promise<Agent | null> {
    return this.copyOrNull(this.agents.get(id));
  }

  async saveAction(input: unknown): Promise<ProtectedAction> {
    const action = protectedActionSchema.parse(input);
    this.assertAbsent(this.actions, action.id, "Action");
    return this.store(this.actions, action.id, action);
  }

  async findActionById(id: string): Promise<ProtectedAction | null> {
    return this.copyOrNull(this.actions.get(id));
  }

  async appendIncident(input: unknown): Promise<Incident> {
    const incident = incidentSchema.parse(input);
    this.assertAbsent(this.incidents, incident.id, "Incident");
    return this.store(this.incidents, incident.id, incident);
  }

  async findIncidentById(id: string): Promise<Incident | null> {
    return this.copyOrNull(this.incidents.get(id));
  }

  async findIncidents(query: IncidentQuery): Promise<Incident[]> {
    const parsedQuery = incidentQuerySchema.parse(query);
    return [...this.incidents.values()]
      .filter(
        (incident) =>
          (!parsedQuery.entityId ||
            incident.entityId === parsedQuery.entityId) &&
          (!parsedQuery.actionType ||
            incident.actionType === parsedQuery.actionType),
      )
      .map((incident) => structuredClone(incident));
  }

  async findIncidentsForAction(actionId: string): Promise<Incident[]> {
    return [...this.incidents.values()]
      .filter((incident) => incident.relatedActionId === actionId)
      .map((incident) => structuredClone(incident));
  }

  async appendIncidentMemoryBundle(input: unknown): Promise<ScarMemoryBundle> {
    const bundle = scarMemoryBundleSchema.parse(input);
    this.assertAbsent(
      this.incidentMemoryBundles,
      bundle.incident.id,
      "Incident memory bundle",
    );
    return this.store(this.incidentMemoryBundles, bundle.incident.id, bundle);
  }

  async findIncidentMemoryBundle(
    incidentId: string,
  ): Promise<ScarMemoryBundle | null> {
    return this.copyOrNull(this.incidentMemoryBundles.get(incidentId));
  }

  async saveAuthorization(input: unknown): Promise<AuthorizationRecord> {
    const authorization = authorizationRecordSchema.parse(input);
    if (
      this.authorizations.has(authorization.actionId) ||
      this.authorizationIds.has(authorization.id)
    ) {
      throw new Error(
        `Authorization for action ${authorization.actionId} already exists`,
      );
    }
    this.authorizations.set(
      authorization.actionId,
      structuredClone(authorization),
    );
    this.authorizationIds.add(authorization.id);
    return structuredClone(authorization);
  }

  async findAuthorizationForAction(
    actionId: string,
  ): Promise<AuthorizationRecord | null> {
    return this.copyOrNull(this.authorizations.get(actionId));
  }

  async saveApproval(input: unknown): Promise<ApprovalRecord> {
    const approval = approvalRecordSchema.parse(input);
    this.assertAbsent(this.approvals, approval.id, "Approval");
    if (this.approvalIdsByAction.has(approval.actionId)) {
      throw new Error(
        `Approval for action ${approval.actionId} and authorization ${approval.authorizationId} already exists`,
      );
    }
    const saved = this.store(this.approvals, approval.id, approval);
    this.approvalIdsByAction.set(approval.actionId, approval.id);
    return saved;
  }

  async findApprovalById(id: string): Promise<ApprovalRecord | null> {
    return this.copyOrNull(this.approvals.get(id));
  }

  async findApprovalForAction(
    actionId: string,
  ): Promise<ApprovalRecord | null> {
    const approvalId = this.approvalIdsByAction.get(actionId);
    return approvalId ? this.copyOrNull(this.approvals.get(approvalId)) : null;
  }

  async claimExecution(input: unknown): Promise<PendingExecutionRecord | null> {
    const execution = pendingExecutionRecordSchema.parse(input);
    if (this.executions.has(execution.actionId)) return null;
    return this.store(this.executions, execution.actionId, execution);
  }

  async completeExecution(input: unknown): Promise<CompletedExecutionRecord> {
    const completion = completedExecutionRecordSchema.parse(input);
    const pending = this.executions.get(completion.actionId);
    if (
      !pending ||
      pending.status !== "PENDING" ||
      pending.id !== completion.id ||
      pending.authorizationId !== completion.authorizationId
    ) {
      throw new Error(
        `Execution ${completion.id} is not the active pending execution`,
      );
    }
    this.executions.set(completion.actionId, structuredClone(completion));
    return structuredClone(completion);
  }

  async findExecutionForAction(
    actionId: string,
  ): Promise<ExecutionRecord | null> {
    return this.copyOrNull(this.executions.get(actionId));
  }

  private assertAbsent<T>(
    records: Map<string, T>,
    id: string,
    recordType: string,
  ): void {
    if (records.has(id)) throw new Error(`${recordType} ${id} already exists`);
  }

  private store<TStored, TValue extends TStored>(
    records: Map<string, TStored>,
    id: string,
    value: TValue,
  ): TValue {
    const stored = structuredClone(value);
    records.set(id, stored);
    return structuredClone(stored);
  }

  private copyOrNull<T>(value: T | undefined): T | null {
    return value === undefined ? null : structuredClone(value);
  }
}
