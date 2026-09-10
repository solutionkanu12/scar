import type { ProtectedAction } from "./domain";
import type {
  ScarMemoryBundle,
  SibylAuditHistory,
  SibylPersistenceReceipt,
  SibylRelevantEvidence,
} from "./sibyl-contract";

export type MemoryEvidenceLookup =
  | {
      status: "AVAILABLE";
      lookupId: string;
      incidents: readonly unknown[];
    }
  | {
      status: "UNAVAILABLE";
      reason: string;
    };

export interface MemoryEvidenceProvider {
  findRelevantIncidents(
    action: ProtectedAction,
  ): Promise<MemoryEvidenceLookup>;
}

export interface ScarMemoryPersistence extends MemoryEvidenceProvider {
  persistScarMemory(input: ScarMemoryBundle): Promise<SibylPersistenceReceipt>;
  findRelevantEvidence(
    action: ProtectedAction,
  ): Promise<SibylRelevantEvidence>;
  readAuditHistory(input: { limit: number }): Promise<SibylAuditHistory>;
}

export interface ExecutionContext {
  /** Identity of the deterministic authorization that permitted this action. */
  authorizationId: string;
}

export interface ExecutionAdapter {
  execute(
    action: ProtectedAction,
    context: ExecutionContext,
  ): Promise<unknown>;
}
