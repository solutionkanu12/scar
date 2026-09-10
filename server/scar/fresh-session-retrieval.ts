import { z } from "zod";

import { protectedActionSchema, type ProtectedAction } from "./domain";
import {
  sibylRelevantEvidenceResponseSchema,
  type SibylRelevantEvidence,
} from "./sibyl-contract";

export interface FreshSessionMemoryReader {
  findRelevantEvidence(action: ProtectedAction): Promise<SibylRelevantEvidence>;
}

export type FreshSessionEvidence =
  | SibylRelevantEvidence
  | {
      status: "UNAVAILABLE";
      reason: "SIBYL_INVALID_RESPONSE" | "SIBYL_UNAVAILABLE";
    };

export async function retrieveFreshSessionEvidence(input: {
  action: ProtectedAction;
  memory: FreshSessionMemoryReader;
}): Promise<FreshSessionEvidence> {
  try {
    const action = protectedActionSchema.parse(input.action);
    const evidence = await input.memory.findRelevantEvidence(action);
    const parsedEvidence = sibylRelevantEvidenceResponseSchema.parse(evidence);
    if (!isRelevantEvidence(action, parsedEvidence)) {
      return {
        status: "UNAVAILABLE",
        reason: "SIBYL_INVALID_RESPONSE",
      };
    }
    return parsedEvidence;
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      reason:
        error instanceof z.ZodError
          ? "SIBYL_INVALID_RESPONSE"
          : "SIBYL_UNAVAILABLE",
    };
  }
}

function isRelevantEvidence(
  action: ProtectedAction,
  evidence: SibylRelevantEvidence,
): boolean {
  if (evidence.entity && evidence.entity.id !== action.entityId) return false;
  if (
    !evidence.entity &&
    (evidence.incidents.length || evidence.safeguards.length)
  ) {
    return false;
  }

  const incidentIds = new Set(evidence.incidents.map((incident) => incident.id));
  const incidentsAreRelevant = evidence.incidents.every(
    (incident) =>
      incident.entityId === action.entityId &&
      incident.actionType === action.actionType,
  );
  const safeguardsAreRelevant = evidence.safeguards.every(
    (safeguard) =>
      safeguard.trigger.entityId === action.entityId &&
      safeguard.trigger.actionType === action.actionType &&
      incidentIds.has(safeguard.sourceIncidentId) &&
      safeguard.scope.agentIds.includes(action.agentId),
  );

  return incidentsAreRelevant && safeguardsAreRelevant;
}
