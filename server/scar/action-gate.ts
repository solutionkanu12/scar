import { z } from "zod";

import {
  agentSchema,
  authorizationRecordSchema,
  identifierSchema,
  protectedActionSchema,
  type AuthorizationRecord,
  type EvidenceReference,
  type Incident,
} from "./domain";
import {
  retrieveFreshSessionEvidence,
  type FreshSessionMemoryReader,
} from "./fresh-session-retrieval";
import type { ScarRepository } from "./repository";

const uintStringSchema = z.string().regex(/^\d+$/).transform(BigInt);

const actionGatePolicySchema = z
  .object({
    policyVersion: identifierSchema,
    maxAmountAtomic: uintStringSchema,
    reviewAmountAtomic: uintStringSchema,
    allowedChainIds: z.array(z.number().int().positive().safe()).min(1),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.maxAmountAtomic <= BigInt(0)) {
      context.addIssue({
        code: "custom",
        path: ["maxAmountAtomic"],
        message: "Maximum amount must be positive",
      });
    }
    if (
      policy.reviewAmountAtomic <= BigInt(0) ||
      policy.reviewAmountAtomic > policy.maxAmountAtomic
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviewAmountAtomic"],
        message: "Review amount must be positive and no greater than maximum",
      });
    }
    if (new Set(policy.allowedChainIds).size !== policy.allowedChainIds.length) {
      context.addIssue({
        code: "custom",
        path: ["allowedChainIds"],
        message: "Allowed chain IDs must be unique",
      });
    }
  });

const authorizationRequestSchema = z
  .object({ actionId: identifierSchema })
  .strict();

export interface ActionGatePolicy {
  policyVersion: string;
  maxAmountAtomic: string;
  reviewAmountAtomic: string;
  allowedChainIds: number[];
}

export interface ActionGateResult {
  actionId: string | null;
  authorizationId: string | null;
  decision: "ALLOW" | "REVIEW" | "BLOCK";
  reasonCode: string;
  rationale: string;
  evidence: EvidenceReference[];
  provenance: AuthorizationRecord["provenance"];
}

interface ActionGateDependencies {
  repository: ScarRepository;
  memory: FreshSessionMemoryReader;
  policy: ActionGatePolicy;
  now: () => string;
  createAuthorizationId: () => string;
}

export class DeterministicActionGate {
  private readonly repository: ScarRepository;
  private readonly memory: FreshSessionMemoryReader;
  private readonly policy: z.infer<typeof actionGatePolicySchema>;
  private readonly now: () => string;
  private readonly createAuthorizationId: () => string;

  constructor(dependencies: ActionGateDependencies) {
    this.repository = dependencies.repository;
    this.memory = dependencies.memory;
    this.policy = actionGatePolicySchema.parse(dependencies.policy);
    this.now = dependencies.now;
    this.createAuthorizationId = dependencies.createAuthorizationId;
  }

  async authorize(input: unknown): Promise<ActionGateResult> {
    const evaluatedAt = this.now();
    const provenance = {
      engine: "SCAR_DETERMINISTIC_POLICY" as const,
      policyVersion: this.policy.policyVersion,
      evaluatedAt,
    };
    const parsedRequest = authorizationRequestSchema.safeParse(input);
    if (!parsedRequest.success) {
      return this.unpersistedBlock(
        null,
        "INVALID_REQUEST",
        "The authorization request must contain only a valid action identity.",
        provenance,
      );
    }

    const actionId = parsedRequest.data.actionId;
    let storedAction: unknown;
    try {
      storedAction = await this.repository.findActionById(actionId);
    } catch {
      return this.unpersistedBlock(
        actionId,
        "ACTION_LOOKUP_UNAVAILABLE",
        "The stored action could not be verified.",
        provenance,
      );
    }
    if (!storedAction) {
      return this.unpersistedBlock(
        actionId,
        "UNKNOWN_ACTION",
        "The action identity does not resolve to a stored action.",
        provenance,
      );
    }

    const parsedAction = protectedActionSchema.safeParse(storedAction);
    if (!parsedAction.success) {
      return this.unpersistedBlock(
        actionId,
        "INVALID_ACTION",
        "The stored action failed validation.",
        provenance,
      );
    }
    const action = parsedAction.data;

    let storedAgent: unknown;
    try {
      storedAgent = await this.repository.findAgentById(action.agentId);
    } catch {
      storedAgent = null;
    }
    const parsedAgent = agentSchema.safeParse(storedAgent);
    if (
      !parsedAgent.success ||
      parsedAgent.data.id !== action.agentId ||
      parsedAgent.data.status !== "ACTIVE" ||
      !parsedAgent.data.permissions.includes(action.actionType)
    ) {
      return this.persistDecision({
        actionId,
        decision: "BLOCK",
        reasonCode: "UNAUTHORIZED_AGENT",
        rationale: "The stored agent is missing, invalid, suspended, or unpermitted.",
        evidence: [this.systemEvidence("UNAUTHORIZED_AGENT", evaluatedAt)],
        provenance,
      });
    }

    if (BigInt(action.amountAtomic) > this.policy.maxAmountAtomic) {
      return this.persistDecision({
        actionId,
        decision: "BLOCK",
        reasonCode: "HARD_AMOUNT_CEILING",
        rationale: "The action exceeds the configured hard amount ceiling.",
        evidence: [this.systemEvidence("HARD_AMOUNT_CEILING", evaluatedAt)],
        provenance,
      });
    }
    if (!this.policy.allowedChainIds.includes(action.chainId)) {
      return this.persistDecision({
        actionId,
        decision: "BLOCK",
        reasonCode: "DISALLOWED_CHAIN",
        rationale: "The action targets a chain disallowed by hard policy.",
        evidence: [this.systemEvidence("DISALLOWED_CHAIN", evaluatedAt)],
        provenance,
      });
    }

    const memory = await retrieveFreshSessionEvidence({
      action,
      memory: this.memory,
    });
    if (memory.status === "UNAVAILABLE") {
      return this.persistDecision({
        actionId,
        decision: "BLOCK",
        reasonCode:
          memory.reason === "SIBYL_INVALID_RESPONSE"
            ? "MEMORY_INCONSISTENT"
            : "MEMORY_UNAVAILABLE",
        rationale: "Required organizational memory could not be validated.",
        evidence: [this.systemEvidence(memory.reason, evaluatedAt)],
        provenance,
      });
    }

    const criticalIncident = this.firstByCreatedAt(
      memory.incidents.filter((incident) => incident.severity === "CRITICAL"),
    );
    if (criticalIncident) {
      return this.persistDecision({
        actionId,
        decision: "BLOCK",
        reasonCode: "CRITICAL_INCIDENT",
        rationale:
          "Validated organizational memory contains a relevant critical incident.",
        evidence: this.incidentEvidence(
          memory.lookupId,
          criticalIncident,
          evaluatedAt,
        ),
        provenance,
      });
    }

    const blockSafeguard = this.firstByCreatedAt(
      memory.safeguards.filter(
        (safeguard) => safeguard.requiredResponse === "BLOCK",
      ),
    );
    if (blockSafeguard) {
      const sourceIncident = memory.incidents.find(
        (incident) => incident.id === blockSafeguard.sourceIncidentId,
      );
      return this.persistDecision({
        actionId,
        decision: "BLOCK",
        reasonCode: "APPLICABLE_BLOCK_SAFEGUARD",
        rationale:
          "Validated organizational memory contains an applicable blocking safeguard.",
        evidence: this.safeguardEvidence(
          memory.lookupId,
          blockSafeguard,
          sourceIncident,
          evaluatedAt,
        ),
        provenance,
      });
    }

    const reviewSafeguard = this.firstByCreatedAt(
      memory.safeguards.filter(
        (safeguard) => safeguard.requiredResponse === "REVIEW",
      ),
    );
    if (reviewSafeguard) {
      const sourceIncident = memory.incidents.find(
        (incident) => incident.id === reviewSafeguard.sourceIncidentId,
      );
      return this.persistDecision({
        actionId,
        decision: "REVIEW",
        reasonCode: "APPLICABLE_REVIEW_SAFEGUARD",
        rationale:
          "Validated organizational memory contains an applicable review safeguard.",
        evidence: this.safeguardEvidence(
          memory.lookupId,
          reviewSafeguard,
          sourceIncident,
          evaluatedAt,
        ),
        provenance,
      });
    }

    if (BigInt(action.amountAtomic) > this.policy.reviewAmountAtomic) {
      return this.persistDecision({
        actionId,
        decision: "REVIEW",
        reasonCode: "REVIEW_AMOUNT_THRESHOLD",
        rationale:
          "The action exceeds the configured review threshold and remains within the hard ceiling.",
        evidence: [
          this.systemEvidence(memory.lookupId, evaluatedAt),
          this.systemEvidence(
            `${this.policy.policyVersion}:REVIEW_AMOUNT_THRESHOLD`,
            evaluatedAt,
          ),
        ],
        provenance,
      });
    }

    return this.persistDecision({
      actionId,
      decision: "ALLOW",
      reasonCode: "NO_RELEVANT_RESTRICTION",
      rationale:
        "The action passed hard policy and validated memory contained no applicable restriction.",
      evidence: [this.systemEvidence(memory.lookupId, evaluatedAt)],
      provenance,
    });
  }

  private async persistDecision(
    input: Omit<AuthorizationRecord, "id">,
  ): Promise<ActionGateResult> {
    const authorization = authorizationRecordSchema.parse({
      ...input,
      id: this.createAuthorizationId(),
    });
    const saved = await this.repository.saveAuthorization(authorization);
    return {
      actionId: saved.actionId,
      authorizationId: saved.id,
      decision: saved.decision,
      reasonCode: saved.reasonCode,
      rationale: saved.rationale,
      evidence: saved.evidence,
      provenance: saved.provenance,
    };
  }

  private unpersistedBlock(
    actionId: string | null,
    reasonCode: string,
    rationale: string,
    provenance: AuthorizationRecord["provenance"],
  ): ActionGateResult {
    return {
      actionId,
      authorizationId: null,
      decision: "BLOCK",
      reasonCode,
      rationale,
      evidence: [this.systemEvidence(reasonCode, provenance.evaluatedAt)],
      provenance,
    };
  }

  private systemEvidence(reference: string, observedAt: string) {
    return {
      kind: "SYSTEM_EVENT" as const,
      reference,
      observedAt,
    };
  }

  private firstByCreatedAt<T extends { id: string; createdAt: string }>(
    records: T[],
  ): T | undefined {
    return [...records].sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    )[0];
  }

  private incidentEvidence(
    lookupId: string,
    incident: Incident,
    evaluatedAt: string,
  ): EvidenceReference[] {
    return [
      this.systemEvidence(lookupId, evaluatedAt),
      this.systemEvidence(incident.id, incident.createdAt),
      ...incident.evidence,
    ].slice(0, 64);
  }

  private safeguardEvidence(
    lookupId: string,
    safeguard: { id: string; createdAt: string },
    sourceIncident: Incident | undefined,
    evaluatedAt: string,
  ): EvidenceReference[] {
    return [
      this.systemEvidence(lookupId, evaluatedAt),
      this.systemEvidence(safeguard.id, safeguard.createdAt),
      ...(sourceIncident
        ? [
            this.systemEvidence(sourceIncident.id, sourceIncident.createdAt),
            ...sourceIncident.evidence,
          ]
        : []),
    ].slice(0, 64);
  }
}
