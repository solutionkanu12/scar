// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createWorkspaceApi,
  type WorkspaceSecurityPort,
} from "@/server/scar/http/workspace-api";

const timestamp = "2026-10-05T12:00:00.000Z";
const ownerId = "123e4567-e89b-12d3-a456-426614174000";
const memberId = "123e4567-e89b-12d3-a456-426614174001";

describe("workspace bootstrap API", () => {
  it("lets any authenticated human create a workspace atomically without an operational role", async () => {
    const createWorkspaceForOwner = vi.fn(async (input: unknown) => {
      const value = input as {
        id: string;
        name: string;
        kind: "PERSONAL" | "ORGANIZATION";
        ownerUserId: string;
        createdAt: string;
      };
      return {
        workspace: {
          id: value.id,
          name: value.name,
          kind: value.kind,
          status: "ACTIVE" as const,
          createdAt: value.createdAt,
        },
        membership: {
          workspaceId: value.id,
          userId: value.ownerUserId,
          membership: "OWNER" as const,
          status: "ACTIVE" as const,
          addedBy: value.ownerUserId,
          createdAt: value.createdAt,
        },
      };
    });
    const api = createApi({
      createWorkspaceForOwner:
        createWorkspaceForOwner as WorkspaceSecurityPort["createWorkspaceForOwner"],
    });

    const response = await api.createWorkspace(
      request("https://scar.test/api/scar/workspaces", {
        name: "Personal Treasury",
        kind: "PERSONAL",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      workspace: {
        id: "workspace:http-001",
        name: "Personal Treasury",
        kind: "PERSONAL",
        status: "ACTIVE",
        createdAt: timestamp,
      },
    });
    expect(createWorkspaceForOwner).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: ownerId }),
    );
    expect(createWorkspaceForOwner.mock.calls[0][0]).not.toHaveProperty("role");
  });

  it("only an OWNER can explicitly grant a role, and the server records the owner as provenance", async () => {
    const assignWorkspaceRole = vi.fn(async (input: unknown) => input);
    const api = createApi({
      assignWorkspaceRole:
        assignWorkspaceRole as WorkspaceSecurityPort["assignWorkspaceRole"],
    });

    const response = await api.assignRole(
      request("https://scar.test/api/scar/workspaces/workspace-alpha/members/roles", {}),
      "workspace-alpha",
      memberId,
      "APPROVER",
    );

    expect(response.status).toBe(201);
    expect(assignWorkspaceRole).toHaveBeenCalledWith({
      id: "role-audit:http-001",
      workspaceId: "workspace-alpha",
      userId: memberId,
      role: "APPROVER",
      assignedBy: ownerId,
      occurredAt: timestamp,
    });
  });

  it("does not let a non-owner grant themselves a role", async () => {
    const assignWorkspaceRole = vi.fn();
    const api = createApi({
      membership: "MEMBER",
      assignWorkspaceRole,
    });

    const response = await api.assignRole(
      request("https://scar.test/api/scar/workspaces/workspace-alpha/members/roles", {}),
      "workspace-alpha",
      ownerId,
      "ADMIN",
    );

    expect(response.status).toBe(404);
    expect(assignWorkspaceRole).not.toHaveBeenCalled();
  });

  it("lets an OWNER revoke a member without granting or preserving an authorization path", async () => {
    const revokeWorkspaceMember = vi.fn(async (input: unknown) => ({
      ...(input as object),
      membership: "MEMBER" as const,
      status: "REVOKED" as const,
      addedBy: ownerId,
      createdAt: timestamp,
    }));
    const api = createApi({
      revokeWorkspaceMember:
        revokeWorkspaceMember as WorkspaceSecurityPort["revokeWorkspaceMember"],
    });

    const response = await api.revokeMember(
      request(
        "https://scar.test/api/scar/workspaces/workspace-alpha/members/member-id",
        {},
        "DELETE",
      ),
      "workspace-alpha",
      memberId,
    );

    expect(response.status).toBe(200);
    expect(revokeWorkspaceMember).toHaveBeenCalledWith({
      workspaceId: "workspace-alpha",
      userId: memberId,
      revokedBy: ownerId,
      revokedAt: timestamp,
    });
  });
});

function createApi(input: {
  membership?: "OWNER" | "MEMBER";
  createWorkspaceForOwner?: WorkspaceSecurityPort["createWorkspaceForOwner"];
  assignWorkspaceRole?: WorkspaceSecurityPort["assignWorkspaceRole"];
  revokeWorkspaceMember?: WorkspaceSecurityPort["revokeWorkspaceMember"];
}) {
  return createWorkspaceApi({
    identityProvider: {
      authenticate: async () => ({ type: "HUMAN" as const, subject: ownerId }),
    },
    security: {
      createWorkspaceForOwner:
        input.createWorkspaceForOwner ??
        (async () => {
          throw new Error("unexpected workspace creation");
        }),
      findActiveWorkspaceMembership: async (workspaceId, userId) => ({
        workspaceId,
        userId,
        membership:
          userId === memberId ? ("MEMBER" as const) : (input.membership ?? "OWNER"),
        status: "ACTIVE" as const,
        addedBy: ownerId,
        createdAt: timestamp,
      }),
      addWorkspaceMember: async () => {
        throw new Error("unexpected member addition");
      },
      revokeWorkspaceMember:
        input.revokeWorkspaceMember ??
        (async () => {
          throw new Error("unexpected member revocation");
        }),
      assignWorkspaceRole:
        input.assignWorkspaceRole ??
        (async () => {
          throw new Error("unexpected role assignment");
        }),
      revokeWorkspaceRole: async () => {
        throw new Error("unexpected role revocation");
      },
      claimRateLimit: async () => true,
      appendHttpAudit: async () => undefined,
    },
    publicOrigin: "https://scar.test",
    now: () => timestamp,
    createId: () => "http-001",
  });
}

function request(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: {
      origin: "https://scar.test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
