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

export interface ExecutionAdapter {
  execute(action: ProtectedAction): Promise<unknown>;
}
