import type { ProtectedAction } from "./domain";

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

export interface ExecutionAdapter {
  execute(action: ProtectedAction): Promise<unknown>;
}
