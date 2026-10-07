import {
  agentSchema,
  approvalRecordSchema,
  authorizationRecordSchema,
  identifierSchema,
  protectedActionSchema,
  type ApprovalRecord,
  type Incident,
  type ProtectedAction,
} from "./domain";
import type { ActionGateResult } from "./action-gate";
import type { ExecutionBoundaryResult } from "./execution-boundary";
import type { ScarMemoryPersistence } from "./ports";
import type { ScarRepository } from "./repository";
import {
  scarMemoryBundleSchema,
  type ScarMemoryBundle,
  type SibylPersistenceReceipt,
} from "./sibyl-contract";

interface ScarServiceDependencies {
  repository: ScarRepository;
  gate: { authorize(input: unknown): Promise<ActionGateResult> };
  executionBoundary: {
    execute(input: unknown): Promise<ExecutionBoundaryResult>;
  };
  memory: ScarMemoryPersistence;
}

export interface ScarActionState {
  action: ProtectedAction;
  authorization: Awaited<
    ReturnType<ScarRepository["findAuthorizationForAction"]>
  >;
  approval: ApprovalRecord | null;
  execution: Awaited<ReturnType<ScarRepository["findExecutionForAction"]>>;
  incidents: Incident[];
}

export interface RecordIncidentResult {
  incident: Incident;
  memoryReceipt: SibylPersistenceReceipt;
}

/** The local incident exists, but sharing the same immutable bundle failed. */
export class ScarMemoryPersistenceError extends Error {
  readonly incident: Incident;

  constructor(incident: Incident, cause: unknown) {
    super(
      `Incident ${incident.id} was persisted locally but could not be shared with Sibyl.`,
      { cause },
    );
    this.name = "ScarMemoryPersistenceError";
    this.incident = incident;
  }
}

/**
 * Application-layer composition for SCAR's explicit operational workflows.
 * Policy stays in DeterministicActionGate and consequential execution stays in
 * ExecutionBoundary; this service coordinates them without reinterpreting
 * either component's decisions.
 */
export class ScarService {
  private readonly repository: ScarRepository;
  private readonly gate: ScarServiceDependencies["gate"];
  private readonly executionBoundary: ScarServiceDependencies["executionBoundary"];
  private readonly memory: ScarMemoryPersistence;

  constructor(dependencies: ScarServiceDependencies) {
    this.repository = dependencies.repository;
    this.gate = dependencies.gate;
    this.executionBoundary = dependencies.executionBoundary;
    this.memory = dependencies.memory;
  }

  async registerAgent(input: unknown) {
    return this.repository.saveAgent(agentSchema.parse(input));
  }

  async getAgent(agentId: unknown) {
    return this.repository.findAgentById(identifierSchema.parse(agentId));
  }

  async proposeAction(input: unknown) {
    return this.repository.saveAction(protectedActionSchema.parse(input));
  }

  async evaluateAction(actionId: unknown): Promise<ActionGateResult> {
    return this.gate.authorize({ actionId: identifierSchema.parse(actionId) });
  }

  async executeAction(input: unknown): Promise<ExecutionBoundaryResult> {
    return this.executionBoundary.execute(input);
  }

  async approveAction(input: unknown): Promise<ApprovalRecord> {
    const approval = approvalRecordSchema.parse(input);
    const [action, storedAuthorization, existingApproval] = await Promise.all([
      this.repository.findActionById(approval.actionId),
      this.repository.findAuthorizationForAction(approval.actionId),
      this.repository.findApprovalForAction(approval.actionId),
    ]);
    const parsedAction = protectedActionSchema.safeParse(action);
    const authorization = authorizationRecordSchema.safeParse(storedAuthorization);
    if (
      !parsedAction.success ||
      !authorization.success ||
      authorization.data.actionId !== approval.actionId ||
      authorization.data.id !== approval.authorizationId ||
      authorization.data.decision !== "REVIEW"
    ) {
      throw new Error("Approval requires a matching persisted REVIEW authorization.");
    }
    if (existingApproval) {
      throw new Error(
        `Approval for action ${approval.actionId} and authorization ${approval.authorizationId} already exists.`,
      );
    }
    return this.repository.saveApproval(approval);
  }

  async recordOutcome(input: unknown): Promise<RecordIncidentResult> {
    return this.recordIncident(input);
  }

  /**
   * Replays only the envelope captured with the local incident. This deliberately
   * accepts no caller-supplied evidence, so a transport retry cannot rewrite
   * organizational safety memory.
   */
  async retryIncident(incidentId: unknown): Promise<RecordIncidentResult> {
    const parsedIncidentId = identifierSchema.parse(incidentId);
    const bundle = await this.repository.findIncidentMemoryBundle(
      parsedIncidentId,
    );
    if (!bundle) {
      throw new Error(
        `Incident ${parsedIncidentId} has no durable memory delivery bundle.`,
      );
    }
    const persistedBundle = scarMemoryBundleSchema.parse(bundle);
    try {
      const memoryReceipt = await this.memory.persistScarMemory(persistedBundle);
      return { incident: persistedBundle.incident, memoryReceipt };
    } catch (error) {
      throw new ScarMemoryPersistenceError(persistedBundle.incident, error);
    }
  }

  async recordIncident(input: unknown): Promise<RecordIncidentResult> {
    const bundle = scarMemoryBundleSchema.parse(input);
    const action = await this.repository.findActionById(
      bundle.incident.relatedActionId,
    );
    const parsedAction = protectedActionSchema.safeParse(action);
    if (
      !parsedAction.success ||
      parsedAction.data.agentId !== bundle.incident.sourceAgentId ||
      parsedAction.data.entityId !== bundle.incident.entityId ||
      parsedAction.data.actionType !== bundle.incident.actionType
    ) {
      throw new Error("Incident must be scoped to its persisted protected action.");
    }

    const incident = await this.persistOrReuseIncident(bundle);
    const persistedBundle = await this.persistOrReuseMemoryBundle({
      ...bundle,
      incident,
    });
    try {
      const memoryReceipt = await this.memory.persistScarMemory(persistedBundle);
      return { incident, memoryReceipt };
    } catch (error) {
      throw new ScarMemoryPersistenceError(incident, error);
    }
  }

  async getActionState(actionId: unknown): Promise<ScarActionState | null> {
    const parsedActionId = identifierSchema.parse(actionId);
    const action = await this.repository.findActionById(parsedActionId);
    if (!action) return null;

    const [authorization, approval, execution, incidents] = await Promise.all([
      this.repository.findAuthorizationForAction(action.id),
      this.repository.findApprovalForAction(action.id),
      this.repository.findExecutionForAction(action.id),
      this.repository.findIncidentsForAction(action.id),
    ]);
    return { action, authorization, approval, execution, incidents };
  }

  private async persistOrReuseIncident(bundle: ScarMemoryBundle): Promise<Incident> {
    const existing = await this.repository.findIncidentById(bundle.incident.id);
    if (existing) {
      this.assertSameIncident(existing, bundle.incident);
      return existing;
    }

    try {
      return await this.repository.appendIncident(bundle.incident);
    } catch (error) {
      const concurrentOrRecovered = await this.repository.findIncidentById(
        bundle.incident.id,
      );
      if (!concurrentOrRecovered) throw error;
      this.assertSameIncident(concurrentOrRecovered, bundle.incident);
      return concurrentOrRecovered;
    }
  }

  private assertSameIncident(existing: Incident, requested: Incident): void {
    if (JSON.stringify(existing) !== JSON.stringify(requested)) {
      throw new Error(
        `Incident ${requested.id} conflicts with the existing append-only incident.`,
      );
    }
  }

  private async persistOrReuseMemoryBundle(
    requested: ScarMemoryBundle,
  ): Promise<ScarMemoryBundle> {
    const existing = await this.repository.findIncidentMemoryBundle(
      requested.incident.id,
    );
    if (existing) {
      this.assertSameMemoryBundle(existing, requested);
      return existing;
    }

    try {
      return await this.repository.appendIncidentMemoryBundle(requested);
    } catch (error) {
      const concurrentOrRecovered = await this.repository.findIncidentMemoryBundle(
        requested.incident.id,
      );
      if (!concurrentOrRecovered) throw error;
      this.assertSameMemoryBundle(concurrentOrRecovered, requested);
      return concurrentOrRecovered;
    }
  }

  private assertSameMemoryBundle(
    existing: ScarMemoryBundle,
    requested: ScarMemoryBundle,
  ): void {
    if (JSON.stringify(existing) !== JSON.stringify(requested)) {
      throw new Error(
        `Incident ${requested.incident.id} conflicts with the existing immutable memory bundle.`,
      );
    }
  }
}
