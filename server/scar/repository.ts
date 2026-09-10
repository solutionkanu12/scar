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

export interface ScarRepository {
  readonly durability: "VOLATILE_PROCESS" | "DURABLE";

  saveAgent(input: unknown): Promise<Agent>;
  findAgentById(id: string): Promise<Agent | null>;

  saveAction(input: unknown): Promise<ProtectedAction>;
  findActionById(id: string): Promise<ProtectedAction | null>;

  appendIncident(input: unknown): Promise<Incident>;
  findIncidentById(id: string): Promise<Incident | null>;
  findIncidents(query: IncidentQuery): Promise<Incident[]>;

  saveAuthorization(input: unknown): Promise<AuthorizationRecord>;
  findAuthorizationForAction(
    actionId: string,
  ): Promise<AuthorizationRecord | null>;

  saveApproval(input: unknown): Promise<ApprovalRecord>;
  findApprovalById(id: string): Promise<ApprovalRecord | null>;

  claimExecution(input: unknown): Promise<PendingExecutionRecord | null>;
  completeExecution(input: unknown): Promise<CompletedExecutionRecord>;
  findExecutionForAction(actionId: string): Promise<ExecutionRecord | null>;
}
