import type {
  Agent,
  ApprovalRecord,
  AuthorizationRecord,
  CompletedExecutionRecord,
  ExecutionRecord,
  Incident,
  IncidentQuery,
  PendingExecutionRecord,
  ProtectedAction,
} from "./domain";
import type { ScarMemoryBundle } from "./sibyl-contract";

export interface ScarRepository {
  readonly durability: "VOLATILE_PROCESS" | "DURABLE";
  /** Mandatory server-resolved tenant scope for every operational query. */
  readonly workspaceId: string;

  saveAgent(input: unknown): Promise<Agent>;
  findAgentById(id: string): Promise<Agent | null>;

  saveAction(input: unknown): Promise<ProtectedAction>;
  findActionById(id: string): Promise<ProtectedAction | null>;

  appendIncident(input: unknown): Promise<Incident>;
  findIncidentById(id: string): Promise<Incident | null>;
  findIncidents(query: IncidentQuery): Promise<Incident[]>;
  findIncidentsForAction(actionId: string): Promise<Incident[]>;
  appendIncidentMemoryBundle(input: unknown): Promise<ScarMemoryBundle>;
  findIncidentMemoryBundle(
    incidentId: string,
  ): Promise<ScarMemoryBundle | null>;

  saveAuthorization(input: unknown): Promise<AuthorizationRecord>;
  findAuthorizationForAction(
    actionId: string,
  ): Promise<AuthorizationRecord | null>;

  saveApproval(input: unknown): Promise<ApprovalRecord>;
  findApprovalById(id: string): Promise<ApprovalRecord | null>;
  findApprovalForAction(actionId: string): Promise<ApprovalRecord | null>;

  claimExecution(input: unknown): Promise<PendingExecutionRecord | null>;
  completeExecution(input: unknown): Promise<CompletedExecutionRecord>;
  findExecutionForAction(actionId: string): Promise<ExecutionRecord | null>;
}
