import { z } from "zod";

import {
  actionTypeSchema,
  incidentSchema,
  identifierSchema,
} from "./domain";

const timestampSchema = z.string().datetime({ offset: true });

export const scarEntitySchema = z
  .object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(240),
    externalIdentifier: z.string().trim().min(1).max(512),
    type: z.enum(["COUNTERPARTY", "SERVICE", "TOOL"]),
    createdAt: timestampSchema,
  })
  .strict();

export const learnedSafeguardSchema = z
  .object({
    id: identifierSchema,
    sourceIncidentId: identifierSchema,
    trigger: z
      .object({
        entityId: identifierSchema,
        actionType: actionTypeSchema,
      })
      .strict(),
    scope: z
      .object({
        agentIds: z.array(identifierSchema).min(1).max(128),
      })
      .strict(),
    requiredResponse: z.enum(["REVIEW", "BLOCK"]),
    reason: z.string().trim().min(1).max(2_000),
    createdAt: timestampSchema,
  })
  .strict();

export const scarAuditEventSchema = z
  .object({
    id: identifierSchema,
    eventType: z.literal("SCAR_RECORDED"),
    actorId: identifierSchema,
    incidentId: identifierSchema,
    entityId: identifierSchema,
    safeguardId: identifierSchema,
    occurredAt: timestampSchema,
  })
  .strict();

export const memoryLookupAuditEventSchema = z
  .object({
    id: identifierSchema,
    eventType: z.literal("MEMORY_LOOKUP"),
    agentId: identifierSchema,
    actionId: identifierSchema,
    entityId: identifierSchema,
    actionType: actionTypeSchema,
    resultIncidentIds: z.array(identifierSchema).max(1_000),
    resultSafeguardIds: z.array(identifierSchema).max(1_000),
    occurredAt: timestampSchema,
  })
  .strict();

export const sibylAuditHistoryResponseSchema = z
  .object({
    events: z
      .array(
        z
          .object({
            memoryId: identifierSchema,
            event: z.union([
              scarAuditEventSchema,
              memoryLookupAuditEventSchema,
            ]),
          })
          .strict(),
      )
      .max(1_000),
  })
  .strict();

export const scarMemoryBundleSchema = z
  .object({
    entity: scarEntitySchema,
    incident: incidentSchema,
    safeguard: learnedSafeguardSchema,
    auditEvent: scarAuditEventSchema,
  })
  .strict()
  .superRefine((bundle, context) => {
    const relationships: Array<[
      boolean,
      Array<string | number>,
      string,
    ]> = [
      [
        bundle.incident.entityId === bundle.entity.id,
        ["incident", "entityId"],
        "Incident entity must match the persisted entity",
      ],
      [
        bundle.safeguard.sourceIncidentId === bundle.incident.id,
        ["safeguard", "sourceIncidentId"],
        "Safeguard source must match the persisted incident",
      ],
      [
        bundle.safeguard.trigger.entityId === bundle.entity.id,
        ["safeguard", "trigger", "entityId"],
        "Safeguard trigger must match the persisted entity",
      ],
      [
        bundle.safeguard.trigger.actionType === bundle.incident.actionType,
        ["safeguard", "trigger", "actionType"],
        "Safeguard trigger must match the incident action type",
      ],
      [
        bundle.auditEvent.incidentId === bundle.incident.id &&
          bundle.auditEvent.entityId === bundle.entity.id &&
          bundle.auditEvent.safeguardId === bundle.safeguard.id,
        ["auditEvent"],
        "Audit event references must match the persisted bundle",
      ],
    ];

    for (const [valid, path, message] of relationships) {
      if (!valid) {
        context.addIssue({ code: z.ZodIssueCode.custom, path, message });
      }
    }
  });

export const sibylPersistenceReceiptSchema = z
  .object({
    entityMemoryId: identifierSchema,
    incidentMemoryId: identifierSchema,
    safeguardMemoryId: identifierSchema,
    auditMemoryId: identifierSchema,
  })
  .strict();

export const sibylRelevantEvidenceResponseSchema = z
  .object({
    status: z.literal("AVAILABLE"),
    lookupId: identifierSchema,
    entity: scarEntitySchema.nullable(),
    incidents: z.array(incidentSchema).max(1_000),
    safeguards: z.array(learnedSafeguardSchema).max(1_000),
  })
  .strict();

export type ScarEntity = z.infer<typeof scarEntitySchema>;
export type LearnedSafeguard = z.infer<typeof learnedSafeguardSchema>;
export type ScarAuditEvent = z.infer<typeof scarAuditEventSchema>;
export type MemoryLookupAuditEvent = z.infer<
  typeof memoryLookupAuditEventSchema
>;
export type SibylAuditHistory = z.infer<
  typeof sibylAuditHistoryResponseSchema
>;
export type ScarMemoryBundle = z.infer<typeof scarMemoryBundleSchema>;
export type SibylPersistenceReceipt = z.infer<
  typeof sibylPersistenceReceiptSchema
>;
export type SibylRelevantEvidence = z.infer<
  typeof sibylRelevantEvidenceResponseSchema
>;
