import { beforeEach, describe, expect, it, vi } from "vitest";

import { createScarHttpApi } from "@/server/scar/http/api";
import type { AgentPrincipal } from "@/server/scar/http/identity";

const runtime = vi.hoisted(() => ({ productionApi: undefined as unknown }));

vi.mock("@/server/scar/http/runtime", () => ({
  getProductionScarHttpApi: () => runtime.productionApi,
}));

import { GET as listAgents } from "@/app/api/scar/workspaces/[workspaceId]/agents/route";
import { POST as issueCredential } from "@/app/api/scar/workspaces/[workspaceId]/agents/[agentId]/credentials/route";
import { GET as listActions } from "@/app/api/scar/workspaces/[workspaceId]/actions/route";
import { POST as approveAction } from "@/app/api/scar/workspaces/[workspaceId]/actions/[actionId]/approvals/route";
import { POST as recordIncident } from "@/app/api/scar/workspaces/[workspaceId]/actions/[actionId]/incidents/route";
import { POST as recordOutcome } from "@/app/api/scar/workspaces/[workspaceId]/actions/[actionId]/outcomes/route";

const routeWorkspaceId = "workspace-alpha";
const otherWorkspacePrincipal: AgentPrincipal = {
  type: "AGENT",
  subject: "credential-beta",
  workspaceId: "workspace-beta",
  agentId: "agent-treasury",
  allowedOperations: ["PROPOSE_ACTION", "READ_ACTION"],
};

function context() {
  return { params: Promise.resolve({ workspaceId: routeWorkspaceId }) };
}

function actionContext() {
  return {
    params: Promise.resolve({
      workspaceId: routeWorkspaceId,
      actionId: "action-001",
    }),
  };
}

function credentialContext() {
  return {
    params: Promise.resolve({
      workspaceId: routeWorkspaceId,
      agentId: "agent-treasury",
    }),
  };
}

function request(path: string, method = "GET") {
  return new Request(`https://scar.test${path}`, { method });
}

describe("workspace route isolation", () => {
  let forWorkspace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const api = createScarHttpApi({
      identityProvider: {
        authenticate: async () => otherWorkspacePrincipal,
      },
      security: {
        findActiveWorkspaceMembership: async () => null,
        findActiveHumanRoles: async () => [],
        claimRateLimit: async () => true,
        appendHttpAudit: async () => undefined,
        saveAgentCredential: async () => undefined,
        findWorkspaceAgentCredential: async () => null,
        revokeWorkspaceAgentCredential: async () => undefined,
        findWorkspaceExecutionConfiguration: async () => null,
      },
      // Every route is rejected during workspace authentication, before any
      // workflow service method or request body is reached.
      service: {} as never,
      workspaceId: routeWorkspaceId,
      publicOrigin: "https://scar.test",
      agentCredentialPepper: "p".repeat(32),
    });
    forWorkspace = vi.fn(() => api);
    runtime.productionApi = {
      multiWorkspaceOperationsEnabled: true,
      forWorkspace,
    };
  });

  it.each([
    ["agents", () => listAgents(request(`/api/scar/workspaces/${routeWorkspaceId}/agents`), context())],
    ["actions", () => listActions(request(`/api/scar/workspaces/${routeWorkspaceId}/actions`), context())],
    ["approvals", () => approveAction(request(`/api/scar/workspaces/${routeWorkspaceId}/actions/action-001/approvals`, "POST"), actionContext())],
    ["incidents", () => recordIncident(request(`/api/scar/workspaces/${routeWorkspaceId}/actions/action-001/incidents`, "POST"), actionContext())],
    ["outcomes", () => recordOutcome(request(`/api/scar/workspaces/${routeWorkspaceId}/actions/action-001/outcomes`, "POST"), actionContext())],
    ["credentials", () => issueCredential(request(`/api/scar/workspaces/${routeWorkspaceId}/agents/agent-treasury/credentials`, "POST"), credentialContext())],
  ])("keeps cross-workspace %s access opaque", async (_resource, invoke) => {
    const response = await invoke();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "WORKSPACE_NOT_FOUND" },
    });
    expect(forWorkspace).toHaveBeenCalledWith(routeWorkspaceId);
  });
});
