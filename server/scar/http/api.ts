import { z } from "zod";

import {
  agentSchema,
  evidenceReferenceSchema,
  identifierSchema,
} from "../domain";
import {
  ScarMemoryPersistenceError,
  type ScarActionState,
  type ScarService,
} from "../scar-service";
import type {
  AgentCredentialRecord,
  AgentOperation,
  HttpAuditRecord,
  HttpOperation,
  ScarRole,
  WorkspaceMembershipRecord,
} from "./contracts";
import {
  AuthenticationError,
  hashAgentCredentialSecret,
  type AuthenticatedPrincipal,
  type IdentityProvider,
} from "./identity";

const MAX_JSON_BYTES = 65_536;
const MAX_CREDENTIAL_LIFETIME_MS = 90 * 24 * 60 * 60 * 1_000;

const actionProposalSchema = z
  .object({
    agentId: identifierSchema,
    actionType: z.literal("USDC_TRANSFER"),
    amountAtomic: z.string().regex(/^\d+$/),
    entityId: identifierSchema,
    recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    chainId: z.number().int().positive().safe(),
  })
  .strict();

const approvalRequestSchema = z
  .object({ authorizationId: identifierSchema })
  .strict();

const executionRequestSchema = z
  .object({ approvalId: identifierSchema.optional() })
  .strict();

const incidentInputSchema = z
  .object({
    entity: z
      .object({
        name: z.string().trim().min(1).max(240),
        externalIdentifier: z.string().trim().min(1).max(512),
        type: z.enum(["COUNTERPARTY", "SERVICE", "TOOL"]),
      })
      .strict(),
    context: z.string().trim().min(1).max(4_000),
    outcome: z.string().trim().min(1).max(4_000),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    reason: z.string().trim().min(1).max(2_000),
    mitigation: z.string().trim().min(1).max(2_000),
    evidence: z.array(evidenceReferenceSchema).min(1).max(64),
    safeguard: z
      .object({
        requiredResponse: z.enum(["REVIEW", "BLOCK"]),
        reason: z.string().trim().min(1).max(2_000),
        scopeAgentIds: z.array(identifierSchema).min(1).max(128),
      })
      .strict(),
  })
  .strict();

const credentialIssueSchema = z
  .object({
    allowedOperations: z
      .array(
        z.enum([
          "PROPOSE_ACTION",
          "EVALUATE_ACTION",
          "EXECUTE_ACTION",
          "READ_ACTION",
        ]),
      )
      .min(1)
      .max(4),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((credential, context) => {
    if (
      new Set(credential.allowedOperations).size !==
      credential.allowedOperations.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedOperations"],
        message: "Agent credential operations must be unique.",
      });
    }
  });

type ScarServicePort = Pick<
  ScarService,
  | "registerAgent"
  | "getAgent"
  | "proposeAction"
  | "evaluateAction"
  | "approveAction"
  | "executeAction"
  | "recordIncident"
  | "recordOutcome"
  | "retryIncident"
  | "getActionState"
>;

export interface ScarHttpSecurityPort {
  findActiveWorkspaceMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipRecord | null>;
  findActiveHumanRoles(workspaceId: string, userId: string): Promise<ScarRole[]>;
  claimRateLimit(input: unknown): Promise<boolean>;
  appendHttpAudit(input: unknown): Promise<HttpAuditRecord | void>;
  saveAgentCredential(input: unknown): Promise<AgentCredentialRecord | void>;
  findWorkspaceAgentCredential(
    workspaceId: string,
    id: string,
  ): Promise<AgentCredentialRecord | null>;
  revokeWorkspaceAgentCredential(
    workspaceId: string,
    id: string,
    revokedAt: string,
  ): Promise<void>;
  findWorkspaceExecutionConfiguration(workspaceId: string): Promise<{
    status: "DISABLED" | "ENABLED";
    executorKeyReference?: string | null;
    chainId?: number | null;
    tokenAddress?: string | null;
  } | null>;
}

export interface ScarHttpApiDependencies {
  identityProvider: IdentityProvider;
  security: ScarHttpSecurityPort;
  service: ScarServicePort;
  /** Server-resolved route scope; never a client-authority field. */
  workspaceId: string;
  /** Browser origin allowed to issue bearer-authenticated requests. */
  publicOrigin: string;
  /** Server-side pepper used only for hashing issued agent credential secrets. */
  agentCredentialPepper?: string;
  now?: () => string;
  createId?: () => string;
  createCredentialSecret?: () => string;
  executionConfigurationAllows?: (input: {
    workspaceId: string;
    configuration: Awaited<
      ReturnType<ScarHttpSecurityPort["findWorkspaceExecutionConfiguration"]>
    >;
  }) => boolean;
}

export function createScarHttpApi(dependencies: ScarHttpApiDependencies) {
  const api = new ScarHttpApi(dependencies);
  return {
    registerAgent: api.registerAgent.bind(api),
    issueAgentCredential: api.issueAgentCredential.bind(api),
    revokeAgentCredential: api.revokeAgentCredential.bind(api),
    proposeAction: api.proposeAction.bind(api),
    evaluateAction: api.evaluateAction.bind(api),
    approveAction: api.approveAction.bind(api),
    executeAction: api.executeAction.bind(api),
    recordIncident: api.recordIncident.bind(api),
    recordOutcome: api.recordOutcome.bind(api),
    retryIncident: api.retryIncident.bind(api),
    getActionState: api.getActionState.bind(api),
  };
}

class ScarHttpApi {
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly createCredentialSecret: () => string;

  constructor(private readonly dependencies: ScarHttpApiDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createId = dependencies.createId ?? (() => crypto.randomUUID());
    this.createCredentialSecret =
      dependencies.createCredentialSecret ?? generateCredentialSecret;
  }

  async registerAgent(request: Request): Promise<Response> {
    return this.mutate(request, "AGENT_REGISTRATION", async () => {
      const input = agentSchema.parse(await readJson(request));
      const agent = await this.dependencies.service.registerAgent(input);
      return jsonResponse({ agent }, 201);
    });
  }

  async issueAgentCredential(request: Request, agentId: string): Promise<Response> {
    return this.mutate(request, "CREDENTIAL_ISSUE", async () => {
      const parsedAgentId = identifierSchema.parse(agentId);
      const agent = await this.dependencies.service.getAgent(parsedAgentId);
      if (!agent) throw new ApiError(404, "AGENT_NOT_FOUND");

      const input = credentialIssueSchema.parse(await readJson(request));
      const now = this.now();
      const expiresAt = Date.parse(input.expiresAt);
      if (
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.parse(now) ||
        expiresAt - Date.parse(now) > MAX_CREDENTIAL_LIFETIME_MS
      ) {
        throw new ApiError(400, "INVALID_CREDENTIAL_EXPIRY");
      }
      const pepper = this.dependencies.agentCredentialPepper;
      if (!pepper || pepper.length < 32) {
        throw new ApiError(503, "CONFIGURATION_INVALID");
      }
      const id = `credential:${this.createId()}`;
      const secret = this.createCredentialSecret();
      const secretHash = await hashAgentCredentialSecret(secret, pepper);
      const credential: AgentCredentialRecord = {
        workspaceId: this.dependencies.workspaceId,
        id,
        agentId: agent.id,
        secretHash,
        allowedOperations: input.allowedOperations,
        status: "ACTIVE",
        createdAt: now,
        expiresAt: input.expiresAt,
      };
      await this.dependencies.security.saveAgentCredential(credential);

      // This is the only response that includes the raw credential secret.
      return jsonResponse(
        {
          credential: {
            id: credential.id,
            agentId: credential.agentId,
            allowedOperations: credential.allowedOperations,
            expiresAt: credential.expiresAt,
          },
          token: `scar_agent_${this.dependencies.workspaceId}.${id}.${secret}`,
        },
        201,
      );
    });
  }

  async revokeAgentCredential(
    request: Request,
    agentId: string,
    credentialId: string,
  ): Promise<Response> {
    return this.mutate(request, "CREDENTIAL_REVOCATION", async () => {
      const parsedAgentId = identifierSchema.parse(agentId);
      const id = identifierSchema.parse(credentialId);
      const credential =
        await this.dependencies.security.findWorkspaceAgentCredential(
          this.dependencies.workspaceId,
          id,
        );
      if (!credential) throw new ApiError(404, "CREDENTIAL_NOT_FOUND");
      if (credential.agentId !== parsedAgentId) {
        throw new ApiError(404, "CREDENTIAL_NOT_FOUND");
      }
      if (credential.status !== "ACTIVE") {
        throw new ApiError(409, "CREDENTIAL_ALREADY_REVOKED");
      }
      await this.dependencies.security.revokeWorkspaceAgentCredential(
        this.dependencies.workspaceId,
        id,
        this.now(),
      );
      return new Response(null, {
        status: 204,
        headers: { "cache-control": "no-store" },
      });
    });
  }

  async proposeAction(request: Request): Promise<Response> {
    return this.mutate(request, "ACTION_PROPOSAL", async (principal) => {
      const input = actionProposalSchema.parse(await readJson(request));
      if (principal.type === "AGENT" && principal.agentId !== input.agentId) {
        throw new ApiError(403, "AGENT_SCOPE_FORBIDDEN");
      }
      const key = idempotencyKey(request);
      const actionId = `action:${key}`;
      const existing = await this.dependencies.service.getActionState(actionId);
      if (existing) {
        if (principal.type === "AGENT" && principal.agentId !== existing.action.agentId) {
          throw new ApiError(403, "AGENT_SCOPE_FORBIDDEN");
        }
        if (!sameProposedAction(existing.action, input)) {
          throw new ApiError(409, "IDEMPOTENCY_KEY_CONFLICT");
        }
        return jsonResponse({ action: existing.action }, 200);
      }
      const action = await this.dependencies.service.proposeAction({
        ...input,
        id: actionId,
        proposedAt: this.now(),
      });
      return jsonResponse({ action }, 201);
    });
  }

  async evaluateAction(request: Request, actionId: string): Promise<Response> {
    return this.mutate(request, "ACTION_EVALUATION", async (principal) => {
      const state = await this.requireActionAccess(principal, actionId);
      if (state.authorization) {
        return jsonResponse({ authorization: state.authorization }, 200);
      }
      const authorization = await this.dependencies.service.evaluateAction(state.action.id);
      return jsonResponse({ authorization }, 201);
    });
  }

  async approveAction(request: Request, actionId: string): Promise<Response> {
    return this.mutate(request, "ACTION_APPROVAL", async (principal) => {
      if (principal.type !== "HUMAN") {
        throw new ApiError(403, "HUMAN_APPROVAL_REQUIRED");
      }
      const input = approvalRequestSchema.parse(await readJson(request));
      const state = await this.requireActionAccess(principal, actionId);
      if (
        !state.authorization ||
        state.authorization.id !== input.authorizationId ||
        state.authorization.decision !== "REVIEW"
      ) {
        throw new ApiError(409, "REVIEW_AUTHORIZATION_REQUIRED");
      }
      if (state.approval) throw new ApiError(409, "APPROVAL_ALREADY_EXISTS");
      const approval = await this.dependencies.service.approveAction({
        id: `approval:${this.createId()}`,
        actionId: state.action.id,
        authorizationId: input.authorizationId,
        approvedBy: principal.subject,
        approvedAt: this.now(),
      });
      return jsonResponse({ approval }, 201);
    });
  }

  async executeAction(request: Request, actionId: string): Promise<Response> {
    return this.mutate(request, "ACTION_EXECUTION", async (principal) => {
      const state = await this.requireActionAccess(principal, actionId);
      const input = executionRequestSchema.parse(await readJson(request));
      const configuration =
        await this.dependencies.security.findWorkspaceExecutionConfiguration(
          this.dependencies.workspaceId,
        );
      if (
        !this.dependencies.executionConfigurationAllows?.({
          workspaceId: this.dependencies.workspaceId,
          configuration,
        })
      ) {
        throw new ApiError(409, "EXECUTION_CONFIGURATION_DISABLED");
      }
      // The execution boundary remains the only path to the adapter.
      const result = await this.dependencies.service.executeAction({
        actionId: state.action.id,
        ...input,
      });
      return jsonResponse(
        { result },
        result.status === "REJECTED" ? 409 : 200,
      );
    });
  }

  async recordIncident(request: Request, actionId: string): Promise<Response> {
    return this.recordActionIncident(request, actionId, "INCIDENT_RECORDING");
  }

  async recordOutcome(request: Request, actionId: string): Promise<Response> {
    return this.recordActionIncident(request, actionId, "OUTCOME_RECORDING");
  }

  async retryIncident(
    request: Request,
    actionId: string,
    incidentId: string,
  ): Promise<Response> {
    return this.mutate(request, "INCIDENT_RETRY", async (principal) => {
      const state = await this.requireActionAccess(principal, actionId);
      const parsedIncidentId = identifierSchema.parse(incidentId);
      if (!state.incidents.some((incident) => incident.id === parsedIncidentId)) {
        throw new ApiError(404, "INCIDENT_NOT_FOUND");
      }
      return this.persistIncidentRetry(parsedIncidentId);
    });
  }

  async getActionState(request: Request, actionId: string): Promise<Response> {
    return this.access(request, "ACTION_READ", async (principal) => {
      const state = await this.requireActionAccess(principal, actionId);
      // This returns the repository-backed service state exactly as stored.
      return jsonResponse({ state }, 200);
    });
  }

  private async recordActionIncident(
    request: Request,
    actionId: string,
    operation: "INCIDENT_RECORDING" | "OUTCOME_RECORDING",
  ): Promise<Response> {
    return this.mutate(request, operation, async (principal) => {
      if (principal.type !== "HUMAN") {
        throw new ApiError(403, "HUMAN_INCIDENT_REPORT_REQUIRED");
      }
      const state = await this.requireActionAccess(principal, actionId);
      if (
        operation === "OUTCOME_RECORDING" &&
        (!state.execution || state.execution.status === "PENDING")
      ) {
        throw new ApiError(409, "EXECUTION_OUTCOME_REQUIRED");
      }
      const key = idempotencyKey(request);
      const incidentId = `incident:${key}`;
      if (state.incidents.some((incident) => incident.id === incidentId)) {
        return this.persistIncidentRetry(incidentId);
      }

      const input = incidentInputSchema.parse(await readJson(request));
      const timestamp = this.now();
      const bundle = {
        entity: {
          id: state.action.entityId,
          ...input.entity,
          createdAt: timestamp,
        },
        incident: {
          id: incidentId,
          sourceAgentId: state.action.agentId,
          relatedActionId: state.action.id,
          entityId: state.action.entityId,
          actionType: state.action.actionType,
          context: input.context,
          outcome: input.outcome,
          severity: input.severity,
          reason: input.reason,
          mitigation: input.mitigation,
          evidence: input.evidence,
          provenance: {
            source:
              operation === "OUTCOME_RECORDING"
                ? "EXECUTION_OUTCOME"
                : "OPERATOR_REPORT",
            recordedBy: principal.subject,
            observedAt: timestamp,
          },
          createdAt: timestamp,
        },
        safeguard: {
          id: `safeguard:${key}`,
          sourceIncidentId: incidentId,
          trigger: {
            entityId: state.action.entityId,
            actionType: state.action.actionType,
          },
          scope: { agentIds: input.safeguard.scopeAgentIds },
          requiredResponse: input.safeguard.requiredResponse,
          reason: input.safeguard.reason,
          createdAt: timestamp,
        },
        auditEvent: {
          id: `memory-audit:${key}`,
          eventType: "SCAR_RECORDED" as const,
          actorId: principal.subject,
          incidentId,
          entityId: state.action.entityId,
          safeguardId: `safeguard:${key}`,
          occurredAt: timestamp,
        },
      };
      try {
        const result =
          operation === "OUTCOME_RECORDING"
            ? await this.dependencies.service.recordOutcome(bundle)
            : await this.dependencies.service.recordIncident(bundle);
        return jsonResponse({ incident: result.incident, memoryShared: true }, 201);
      } catch (error) {
        if (error instanceof ScarMemoryPersistenceError) {
          return memoryPersistencePendingResponse(error);
        }
        throw error;
      }
    });
  }

  private async persistIncidentRetry(incidentId: string): Promise<Response> {
    try {
      const result = await this.dependencies.service.retryIncident(incidentId);
      return jsonResponse({ incident: result.incident, memoryShared: true }, 200);
    } catch (error) {
      if (error instanceof ScarMemoryPersistenceError) {
        return memoryPersistencePendingResponse(error);
      }
      throw error;
    }
  }

  private async mutate(
    request: Request,
    operation: HttpOperation,
    handler: (principal: AuthenticatedPrincipal) => Promise<Response>,
  ): Promise<Response> {
    return this.authorize(request, operation, true, handler);
  }

  private async access(
    request: Request,
    operation: HttpOperation,
    handler: (principal: AuthenticatedPrincipal) => Promise<Response>,
  ): Promise<Response> {
    return this.authorize(request, operation, false, handler);
  }

  private async authorize(
    request: Request,
    operation: HttpOperation,
    mutation: boolean,
    handler: (principal: AuthenticatedPrincipal) => Promise<Response>,
  ): Promise<Response> {
    try {
      const principal = await this.requirePrincipal(request, operation);
      // Browser-origin checks mitigate cross-site bearer use for humans. A
      // headless agent has no browser Origin header and is instead bound by its
      // revocable credential, exact workspace, agent, and operation scope.
      if (mutation && principal.type === "HUMAN") {
        requireAllowedOrigin(request, this.dependencies.publicOrigin);
      }
      const rateLimited = await this.dependencies.security.claimRateLimit({
        workspaceId: this.dependencies.workspaceId,
        principalId: principal.subject,
        operation,
        windowStartedAt: minuteWindow(this.now()),
        limit: limitFor(operation),
      });
      if (!rateLimited) {
        return errorResponse(429, "RATE_LIMITED", { "retry-after": "60" });
      }
      await this.appendAcceptedAudit(principal, operation);
      return await handler(principal);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  private async requirePrincipal(
    request: Request,
    operation: HttpOperation,
  ): Promise<AuthenticatedPrincipal> {
    const principal = await this.dependencies.identityProvider.authenticate(request);
    if (principal.type === "AGENT") {
      if (principal.workspaceId !== this.dependencies.workspaceId) {
        throw new ApiError(404, "WORKSPACE_NOT_FOUND");
      }
      const allowed = agentOperationFor(operation);
      if (!allowed || !principal.allowedOperations.includes(allowed)) {
        throw new ApiError(403, "AGENT_OPERATION_FORBIDDEN");
      }
      return principal;
    }

    const membership = await this.dependencies.security.findActiveWorkspaceMembership(
      this.dependencies.workspaceId,
      principal.subject,
    );
    if (!membership) {
      throw new ApiError(404, "WORKSPACE_NOT_FOUND");
    }
    if (ownerAllows(membership, operation)) {
      return principal;
    }
    const roles = await this.dependencies.security.findActiveHumanRoles(
      this.dependencies.workspaceId,
      principal.subject,
    );
    if (!roles.some((role) => roleAllows(role, operation))) {
      throw new ApiError(403, "ROLE_FORBIDDEN");
    }
    return principal;
  }

  private async requireActionAccess(
    principal: AuthenticatedPrincipal,
    actionId: string,
  ): Promise<ScarActionState> {
    const state = await this.dependencies.service.getActionState(
      identifierSchema.parse(actionId),
    );
    if (!state) throw new ApiError(404, "ACTION_NOT_FOUND");
    if (principal.type === "AGENT" && principal.agentId !== state.action.agentId) {
      throw new ApiError(403, "AGENT_SCOPE_FORBIDDEN");
    }
    return state;
  }

  private async appendAcceptedAudit(
    principal: AuthenticatedPrincipal,
    operation: HttpOperation,
  ): Promise<void> {
    const id = this.createId();
    await this.dependencies.security.appendHttpAudit({
      id: `audit:${id}`,
      workspaceId: this.dependencies.workspaceId,
      requestId: `request:${id}`,
      principalType: principal.type,
      principalId: principal.subject,
      operation,
      outcome: "ACCEPTED",
      statusCode: 202,
      occurredAt: this.now(),
    });
  }
}

function roleAllows(role: ScarRole, operation: HttpOperation): boolean {
  if (role === "ADMIN") return true;
  if (operation === "ACTION_READ") return true;
  if (role === "OPERATOR") {
    return ["ACTION_PROPOSAL", "ACTION_EVALUATION", "ACTION_EXECUTION"].includes(
      operation,
    );
  }
  if (role === "APPROVER") return operation === "ACTION_APPROVAL";
  return ["INCIDENT_RECORDING", "OUTCOME_RECORDING", "INCIDENT_RETRY"].includes(
    operation,
  );
}

/** Ownership permits workspace and agent administration, not safety decisions. */
function ownerAllows(
  membership: WorkspaceMembershipRecord,
  operation: HttpOperation,
): boolean {
  return (
    membership.membership === "OWNER" &&
    [
      "AGENT_REGISTRATION",
      "CREDENTIAL_ISSUE",
      "CREDENTIAL_REVOCATION",
    ].includes(operation)
  );
}

function agentOperationFor(operation: HttpOperation): AgentOperation | null {
  switch (operation) {
    case "ACTION_PROPOSAL":
      return "PROPOSE_ACTION";
    case "ACTION_EVALUATION":
      return "EVALUATE_ACTION";
    case "ACTION_EXECUTION":
      return "EXECUTE_ACTION";
    case "ACTION_READ":
      return "READ_ACTION";
    default:
      return null;
  }
}

function sameProposedAction(
  stored: ScarActionState["action"],
  proposed: z.infer<typeof actionProposalSchema>,
): boolean {
  return (
    stored.agentId === proposed.agentId &&
    stored.actionType === proposed.actionType &&
    stored.amountAtomic === proposed.amountAtomic &&
    stored.entityId === proposed.entityId &&
    stored.recipient.toLowerCase() === proposed.recipient.toLowerCase() &&
    stored.chainId === proposed.chainId
  );
}

function limitFor(operation: HttpOperation): number {
  if (operation === "ACTION_EXECUTION" || operation === "ACTION_APPROVAL") {
    return 10;
  }
  if (
    operation === "AGENT_REGISTRATION" ||
    operation === "CREDENTIAL_ISSUE" ||
    operation === "CREDENTIAL_REVOCATION"
  ) {
    return 5;
  }
  return 30;
}

function minuteWindow(now: string): string {
  const value = new Date(now);
  value.setUTCSeconds(0, 0);
  return value.toISOString();
}

function requireAllowedOrigin(request: Request, expectedOrigin: string): void {
  const origin = request.headers.get("origin");
  // API agents run outside a browser and do not send Origin. Browser requests
  // may use only the configured SCAR origin; no permissive CORS is emitted.
  if (origin !== null && origin !== expectedOrigin) {
    throw new ApiError(403, "ORIGIN_FORBIDDEN");
  }
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new ApiError(415, "JSON_REQUIRED");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_JSON_BYTES) {
    throw new ApiError(413, "REQUEST_TOO_LARGE");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "JSON_REQUIRED");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new ApiError(413, "REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(merged)) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_JSON");
  }
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get("idempotency-key");
  const parsed = z
    .string()
    .min(16)
    .max(96)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
    .safeParse(value);
  if (!parsed.success) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED");
  return parsed.data;
}

function generateCredentialSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function toErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) return errorResponse(error.status, error.code);
  if (error instanceof AuthenticationError) return errorResponse(401, "UNAUTHENTICATED");
  if (error instanceof ScarMemoryPersistenceError) {
    return memoryPersistencePendingResponse(error);
  }
  if (error instanceof z.ZodError) return errorResponse(400, "INVALID_REQUEST");
  return errorResponse(503, "DEPENDENCY_UNAVAILABLE");
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function memoryPersistencePendingResponse(
  error: ScarMemoryPersistenceError,
): Response {
  return jsonResponse(
    {
      error: { code: "MEMORY_PERSISTENCE_PENDING" },
      incidentId: error.incident.id,
      memoryShared: false,
    },
    503,
  );
}

function errorResponse(
  status: number,
  code: string,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { error: { code } },
    {
      status,
      headers: { "cache-control": "no-store", ...headers },
    },
  );
}
