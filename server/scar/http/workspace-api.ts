import { z } from "zod";

import { identifierSchema } from "../domain";
import type {
  HttpAuditRecord,
  HttpOperation,
  WorkspaceMembershipRecord,
  WorkspaceRecord,
  WorkspaceRoleAuditRecord,
} from "./contracts";
import {
  addWorkspaceMemberSchema,
  assignWorkspaceRoleSchema,
  createWorkspaceForOwnerSchema,
  revokeWorkspaceMemberSchema,
  revokeWorkspaceRoleSchema,
  workspaceKindSchema,
} from "./contracts";
import {
  AuthenticationError,
  type AuthenticatedPrincipal,
  type IdentityProvider,
} from "./identity";

const MAX_JSON_BYTES = 16_384;
const BOOTSTRAP_RATE_SCOPE = "workspace:bootstrap";

const createWorkspaceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: workspaceKindSchema,
  })
  .strict();

const addMemberRequestSchema = z
  .object({ userId: z.string().uuid() })
  .strict();

export interface WorkspaceSecurityPort {
  createWorkspaceForOwner(input: unknown): Promise<{
    workspace: WorkspaceRecord;
    membership: WorkspaceMembershipRecord;
  }>;
  findActiveWorkspaceMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipRecord | null>;
  addWorkspaceMember(input: unknown): Promise<WorkspaceMembershipRecord>;
  revokeWorkspaceMember(input: unknown): Promise<WorkspaceMembershipRecord>;
  assignWorkspaceRole(input: unknown): Promise<WorkspaceRoleAuditRecord>;
  revokeWorkspaceRole(input: unknown): Promise<WorkspaceRoleAuditRecord>;
  claimRateLimit(input: unknown): Promise<boolean>;
  appendHttpAudit(input: unknown): Promise<HttpAuditRecord | void>;
}

export interface WorkspaceApiDependencies {
  identityProvider: IdentityProvider;
  security: WorkspaceSecurityPort;
  publicOrigin: string;
  now?: () => string;
  createId?: () => string;
}

/**
 * Public workspace bootstrap and owner-only membership administration. This is
 * intentionally separate from operational workflows: ownership is not an
 * ADMIN/OPERATOR/APPROVER/SAFETY role and creates none of them implicitly.
 */
export function createWorkspaceApi(dependencies: WorkspaceApiDependencies) {
  const api = new WorkspaceApi(dependencies);
  return {
    createWorkspace: api.createWorkspace.bind(api),
    addMember: api.addMember.bind(api),
    revokeMember: api.revokeMember.bind(api),
    assignRole: api.assignRole.bind(api),
    revokeRole: api.revokeRole.bind(api),
  };
}

class WorkspaceApi {
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(private readonly dependencies: WorkspaceApiDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createId = dependencies.createId ?? (() => crypto.randomUUID());
  }

  async createWorkspace(request: Request): Promise<Response> {
    try {
      requireAllowedOrigin(request, this.dependencies.publicOrigin);
      const principal = await this.requireHuman(request);
      await this.claim(principal, BOOTSTRAP_RATE_SCOPE, "WORKSPACE_CREATION");
      const input = createWorkspaceRequestSchema.parse(await readJson(request));
      const now = this.now();
      const workspaceId = `workspace:${this.createId()}`;
      const created = await this.dependencies.security.createWorkspaceForOwner(
        createWorkspaceForOwnerSchema.parse({
          id: workspaceId,
          name: input.name,
          kind: input.kind,
          ownerUserId: principal.subject,
          createdAt: now,
        }),
      );
      await this.audit(principal, workspaceId, "WORKSPACE_CREATION", 201);
      return jsonResponse({ workspace: created.workspace }, 201);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  async addMember(request: Request, workspaceId: string): Promise<Response> {
    try {
      const scope = identifierSchema.parse(workspaceId);
      requireAllowedOrigin(request, this.dependencies.publicOrigin);
      const principal = await this.requireOwner(request, scope);
      await this.claim(principal, scope, "WORKSPACE_MEMBER_ADDITION");
      const input = addMemberRequestSchema.parse(await readJson(request));
      const member = await this.dependencies.security.addWorkspaceMember(
        addWorkspaceMemberSchema.parse({
          workspaceId: scope,
          userId: input.userId,
          membership: "MEMBER",
          addedBy: principal.subject,
          createdAt: this.now(),
        }),
      );
      await this.audit(principal, scope, "WORKSPACE_MEMBER_ADDITION", 201);
      return jsonResponse({ membership: member }, 201);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  async revokeMember(
    request: Request,
    workspaceId: string,
    userId: string,
  ): Promise<Response> {
    try {
      const scope = identifierSchema.parse(workspaceId);
      const targetUserId = z.string().uuid().parse(userId);
      requireAllowedOrigin(request, this.dependencies.publicOrigin);
      const principal = await this.requireOwner(request, scope);
      const target = await this.dependencies.security.findActiveWorkspaceMembership(
        scope,
        targetUserId,
      );
      if (!target || target.membership !== "MEMBER") {
        throw new ApiError(404, "WORKSPACE_MEMBER_NOT_FOUND");
      }
      await this.claim(principal, scope, "WORKSPACE_MEMBER_REVOCATION");
      const member = await this.dependencies.security.revokeWorkspaceMember(
        revokeWorkspaceMemberSchema.parse({
          workspaceId: scope,
          userId: targetUserId,
          revokedBy: principal.subject,
          revokedAt: this.now(),
        }),
      );
      await this.audit(principal, scope, "WORKSPACE_MEMBER_REVOCATION", 200);
      return jsonResponse({ membership: member }, 200);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  async assignRole(
    request: Request,
    workspaceId: string,
    userId: string,
    role: string,
  ): Promise<Response> {
    return this.changeRole(request, workspaceId, userId, role, "ASSIGNED");
  }

  async revokeRole(
    request: Request,
    workspaceId: string,
    userId: string,
    role: string,
  ): Promise<Response> {
    return this.changeRole(request, workspaceId, userId, role, "REVOKED");
  }

  private async changeRole(
    request: Request,
    workspaceId: string,
    userId: string,
    role: string,
    change: "ASSIGNED" | "REVOKED",
  ): Promise<Response> {
    try {
      const scope = identifierSchema.parse(workspaceId);
      const targetUserId = z.string().uuid().parse(userId);
      const parsedRole = z
        .enum(["ADMIN", "OPERATOR", "APPROVER", "SAFETY_OFFICER"])
        .parse(role);
      requireAllowedOrigin(request, this.dependencies.publicOrigin);
      const principal = await this.requireOwner(request, scope);
      const operation =
        change === "ASSIGNED"
          ? "WORKSPACE_ROLE_ASSIGNMENT"
          : "WORKSPACE_ROLE_REVOCATION";
      await this.claim(principal, scope, operation);
      const occurredAt = this.now();
      const auditId = `role-audit:${this.createId()}`;
      const audit =
        change === "ASSIGNED"
          ? await this.dependencies.security.assignWorkspaceRole(
              assignWorkspaceRoleSchema.parse({
                id: auditId,
                workspaceId: scope,
                userId: targetUserId,
                role: parsedRole,
                assignedBy: principal.subject,
                occurredAt,
              }),
            )
          : await this.dependencies.security.revokeWorkspaceRole(
              revokeWorkspaceRoleSchema.parse({
                id: auditId,
                workspaceId: scope,
                userId: targetUserId,
                role: parsedRole,
                revokedBy: principal.subject,
                occurredAt,
              }),
            );
      await this.audit(principal, scope, operation, 201);
      return jsonResponse({ roleAudit: audit }, 201);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  private async requireOwner(
    request: Request,
    workspaceId: string,
  ): Promise<Extract<AuthenticatedPrincipal, { type: "HUMAN" }>> {
    const principal = await this.requireHuman(request);
    const membership = await this.dependencies.security.findActiveWorkspaceMembership(
      workspaceId,
      principal.subject,
    );
    if (!membership || membership.membership !== "OWNER") {
      // Same response for unknown and non-owned workspace avoids enumeration.
      throw new ApiError(404, "WORKSPACE_NOT_FOUND");
    }
    return principal;
  }

  private async requireHuman(
    request: Request,
  ): Promise<Extract<AuthenticatedPrincipal, { type: "HUMAN" }>> {
    const principal = await this.dependencies.identityProvider.authenticate(request);
    if (principal.type !== "HUMAN") {
      throw new ApiError(403, "HUMAN_WORKSPACE_OWNER_REQUIRED");
    }
    return principal;
  }

  private async claim(
    principal: Extract<AuthenticatedPrincipal, { type: "HUMAN" }>,
    workspaceId: string,
    operation: HttpOperation,
  ): Promise<void> {
    const accepted = await this.dependencies.security.claimRateLimit({
      workspaceId,
      principalId: principal.subject,
      operation,
      windowStartedAt: minuteWindow(this.now()),
      limit: operation === "WORKSPACE_CREATION" ? 5 : 20,
    });
    if (!accepted) throw new ApiError(429, "RATE_LIMITED");
  }

  private async audit(
    principal: Extract<AuthenticatedPrincipal, { type: "HUMAN" }>,
    workspaceId: string,
    operation: HttpOperation,
    statusCode: number,
  ): Promise<void> {
    const id = this.createId();
    await this.dependencies.security.appendHttpAudit({
      id: `audit:${id}`,
      workspaceId,
      requestId: `request:${id}`,
      principalType: "HUMAN",
      principalId: principal.subject,
      operation,
      outcome: "COMPLETED",
      statusCode,
      occurredAt: this.now(),
    });
  }
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function readJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_JSON_BYTES)) {
    throw new ApiError(413, "REQUEST_TOO_LARGE");
  }
  const body = await request.text();
  if (!body || new TextEncoder().encode(body).byteLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "REQUEST_TOO_LARGE");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_JSON");
  }
}

function requireAllowedOrigin(request: Request, allowedOrigin: string): void {
  const origin = request.headers.get("origin");
  if (origin !== allowedOrigin) throw new ApiError(403, "ORIGIN_FORBIDDEN");
}

function minuteWindow(now: string): string {
  const parsed = new Date(now);
  if (Number.isNaN(parsed.valueOf())) throw new ApiError(503, "CLOCK_UNAVAILABLE");
  parsed.setUTCSeconds(0, 0);
  return parsed.toISOString();
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function toErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse({ error: { code: error.code } }, error.status);
  }
  if (error instanceof AuthenticationError) {
    return jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401);
  }
  if (error instanceof z.ZodError) {
    return jsonResponse({ error: { code: "INVALID_REQUEST" } }, 400);
  }
  return jsonResponse({ error: { code: "REQUEST_FAILED" } }, 500);
}
