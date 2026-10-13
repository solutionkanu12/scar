import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ScarAuthClient, ScarSession } from "@/features/scar/auth";
import { ScarConsole } from "@/features/scar/scar-console";
import type { ActionState, Agent, Authorization, Incident, Workspace } from "@/features/scar/scar-api";

const workspace: Workspace = {
  id: "workspace:alpha",
  name: "Alpha",
  kind: "PERSONAL",
  status: "ACTIVE",
  createdAt: "2026-10-07T10:00:00.000Z",
};
const agentA: Agent = { id: "agent:a", name: "Agent A", role: "Treasury", status: "ACTIVE", permissions: ["USDC_TRANSFER"] };
const agentB: Agent = { id: "agent:b", name: "Agent B", role: "Procurement", status: "ACTIVE", permissions: ["USDC_TRANSFER"] };
const session = {
  access_token: "real-access-token-for-mocked-boundary",
  user: { id: "11111111-1111-4111-8111-111111111111", email: "operator@example.com" },
} as ScarSession;

function authorization(decision: Authorization["decision"]): Authorization {
  return {
    id: "authorization:1",
    actionId: "action:1",
    decision,
    reasonCode: decision === "BLOCK" ? "SIBYL_SAFEGUARD" : decision === "REVIEW" ? "POLICY_REVIEW" : "POLICY_ALLOW",
    rationale: decision === "BLOCK" ? "A persisted Scar requires this action to be blocked." : decision === "REVIEW" ? "This action needs a real human approval." : "No matching safeguard blocked this action.",
    evidence: [{ kind: "SYSTEM_EVENT", reference: "gate:evidence", observedAt: "2026-10-07T10:01:00.000Z" }],
    provenance: { engine: "SCAR_DETERMINISTIC_POLICY", policyVersion: "policy:v1", evaluatedAt: "2026-10-07T10:01:00.000Z" },
  };
}

function actionState(input: Partial<ActionState> & { agentId?: string } = {}): ActionState {
  return {
    action: { id: "action:1", agentId: input.agentId ?? agentA.id, actionType: "USDC_TRANSFER", amountAtomic: "1000000", entityId: "supplier:alpha", recipient: "0x1111111111111111111111111111111111111111", chainId: 84532, proposedAt: "2026-10-07T10:00:00.000Z" },
    authorization: null,
    approval: null,
    execution: null,
    incidents: [],
    ...input,
  };
}

function incident(): Incident {
  return { id: "incident:pending", sourceAgentId: agentA.id, relatedActionId: "action:1", entityId: "supplier:alpha", actionType: "USDC_TRANSFER", context: "Settlement mismatch", outcome: "Recipient could not be verified.", severity: "HIGH", reason: "Unexpected settlement behavior", mitigation: "Stop future transfers", evidence: [{ kind: "OPERATOR_NOTE", reference: "operator:note", observedAt: "2026-10-07T10:03:00.000Z" }], provenance: { source: "OPERATOR_REPORT", recordedBy: session.user.id, observedAt: "2026-10-07T10:03:00.000Z" }, createdAt: "2026-10-07T10:03:00.000Z" };
}

class TestAuthClient implements ScarAuthClient {
  private listeners = new Set<(event: never, value: ScarSession | null) => void>();
  constructor(private current: ScarSession | null) {}
  async getSession() { return { data: { session: this.current } }; }
  onAuthStateChange(listener: (event: never, value: ScarSession | null) => void) { this.listeners.add(listener); return { data: { subscription: { unsubscribe: () => this.listeners.delete(listener) } } }; }
  async signInWithPassword() { return { error: null }; }
  async signUp() { return { data: { session: this.current }, error: null }; }
  async signOut() { this.current = null; this.listeners.forEach((listener) => listener("SIGNED_OUT" as never, null)); return { error: null }; }
}

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequestJson(body: BodyInit | null | undefined): Record<string, unknown> {
  const value: unknown = JSON.parse(String(body));
  if (!isRecord(value)) throw new Error("Expected a JSON object request body.");
  return value;
}

function renderConsole(request: typeof fetch, client = new TestAuthClient(session)) {
  render(<ScarConsole onHome={() => undefined} authClient={client} request={request} />);
  return { client };
}

function commonRequest(state: () => ActionState, setState: (next: ActionState) => void, agents = [agentA]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === "/api/scar/workspaces") return json({ workspaces: [workspace] });
    if (path.endsWith("/agents")) return json({ agents });
    if (path.endsWith("/actions") && init?.method === "GET") return json({ states: [state()] });
    if (path.includes("/actions/action:1") && init?.method === "GET") return json({ state: state() });
    if (path.endsWith("/evaluate")) return json({ authorization: state().authorization });
    if (path.endsWith("/approvals")) return json({ approval: state().approval });
    if (path.endsWith("/execute")) return json({ result: { status: "COMPLETED" } });
    throw new Error(`Unexpected request ${init?.method} ${path}`);
  }) as unknown as typeof fetch;
}

async function openAction() {
  await screen.findByRole("button", { name: "Open Agent A action to supplier:alpha" });
  fireEvent.click(screen.getByRole("button", { name: "Open Agent A action to supplier:alpha" }));
}

describe("authenticated SCAR console", () => {
  it("restores an authenticated session and loads only backend-returned workspaces", async () => {
    let current = actionState();
    const request = commonRequest(() => current, (next) => { current = next; });
    renderConsole(request);
    expect(await screen.findByText("Every action carries what your agents learned.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Active workspace" })).toHaveValue(workspace.id);
    const authHeader = (request as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.headers as Headers;
    expect(authHeader.get("authorization")).toBe(`Bearer ${session.access_token}`);
  });

  it("creates a missing workspace and activates the backend-created workspace", async () => {
    let created = false;
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/scar/workspaces" && init?.method === "GET") return json({ workspaces: created ? [workspace] : [] });
      if (path === "/api/scar/workspaces" && init?.method === "POST") { created = true; return json({ workspace }, 201); }
      if (path.endsWith("/agents")) return json({ agents: [] });
      if (path.endsWith("/actions")) return json({ states: [] });
      throw new Error(`Unexpected ${path}`);
    }) as unknown as typeof fetch;
    renderConsole(request);
    expect(await screen.findByRole("heading", { name: "Create your first workspace" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Workspace name" }), { target: { value: "Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Active workspace" })).toHaveValue(workspace.id));
  });

  it("provisions a caller-generated credential for one-time browser copy", async () => {
    const credentialRequests: { body: Record<string, unknown>; headers: Headers }[] = [];
    const request: typeof fetch = async (input, init) => {
      const path = String(input);
      if (path === "/api/scar/workspaces") return json({ workspaces: [workspace] });
      if (path.endsWith("/agents") && init?.method === "GET") return json({ agents: [agentA] });
      if (path.endsWith("/actions") && init?.method === "GET") return json({ states: [] });
      if (path.endsWith("/credentials") && init?.method === "POST") {
        credentialRequests.push({
          body: parseRequestJson(init.body),
          headers: new Headers(init.headers),
        });
        return json({
          credential: {
            id: "credential:browser-001",
            workspaceId: workspace.id,
            agentId: agentA.id,
            allowedOperations: ["PROPOSE_ACTION"],
            status: "ACTIVE",
            createdAt: "2026-10-08T12:00:00.000Z",
            expiresAt: "2026-11-07T12:00:00.000Z",
          },
        }, 201);
      }
      throw new Error(`Unexpected ${init?.method} ${path}`);
    };

    renderConsole(request);
    await screen.findByText("Every action carries what your agents learned.");
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    fireEvent.click(await screen.findByRole("button", { name: "Provision credential" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.submit(dialog.querySelector("form")!);

    const token = await screen.findByRole("textbox", { name: "Bearer credential" });
    const bearer = (token as HTMLTextAreaElement).value;
    expect(bearer).toMatch(
      /^Bearer scar_agent_workspace:alpha\.credential:browser-001\.[A-Za-z0-9_-]{64}$/,
    );
    expect(screen.getByRole("button", { name: "Copy credential" })).toBeInTheDocument();
    expect(credentialRequests).toHaveLength(1);
    const credentialRequest = credentialRequests[0];
    if (!credentialRequest) throw new Error("The credential request was not sent.");
    expect(credentialRequest.body.secret).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(credentialRequest.body).not.toHaveProperty("token");
    expect(credentialRequest.headers.get("authorization")).toBe(`Bearer ${session.access_token}`);
    const durable = JSON.stringify({
      localStorage: { ...window.localStorage },
      sessionStorage: { ...window.sessionStorage },
    });
    expect(durable).not.toContain(bearer);
    expect(durable).not.toContain(String(credentialRequest.body.secret));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("textbox", { name: "Bearer credential" })).not.toBeInTheDocument();
  });

  it("renders the real ALLOW lifecycle after evaluation", async () => {
    let current = actionState();
    const request = commonRequest(() => current, (next) => { current = next; });
    (request as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/scar/workspaces") return json({ workspaces: [workspace] });
      if (path.endsWith("/agents")) return json({ agents: [agentA] });
      if (path.endsWith("/actions") && init?.method === "GET") return json({ states: [current] });
      if (path.endsWith("/evaluate")) { current = { ...current, authorization: authorization("ALLOW") }; return json({ authorization: current.authorization }, 201); }
      if (path.includes("/actions/") && init?.method === "GET") return json({ state: current });
      throw new Error(`Unexpected ${init?.method} ${path}`);
    });
    renderConsole(request);
    await openAction();
    fireEvent.click(screen.getByRole("button", { name: "Evaluate this action" }));
    expect(await screen.findByRole("heading", { name: "ALLOW" })).toBeInTheDocument();
    expect(screen.getByText("No matching safeguard blocked this action.")).toBeInTheDocument();
  });

  it("requires a real REVIEW approval before making execute available", async () => {
    let current = actionState({ authorization: authorization("REVIEW") });
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/scar/workspaces") return json({ workspaces: [workspace] });
      if (path.endsWith("/agents")) return json({ agents: [agentA] });
      if (path.endsWith("/actions") && init?.method === "GET") return json({ states: [current] });
      if (path.endsWith("/approvals")) { current = { ...current, approval: { id: "approval:1", actionId: "action:1", authorizationId: "authorization:1", approvedBy: session.user.id, approvedAt: "2026-10-07T10:02:00.000Z" } }; return json({ approval: current.approval }, 201); }
      if (path.endsWith("/execute")) { current = { ...current, execution: { id: "execution:1", actionId: "action:1", authorizationId: "authorization:1", status: "SUCCEEDED", startedAt: "2026-10-07T10:02:00.000Z", completedAt: "2026-10-07T10:03:00.000Z", externalReference: "0xabc" } }; return json({ result: { status: "COMPLETED" } }); }
      if (path.includes("/actions/") && init?.method === "GET") return json({ state: current });
      throw new Error(`Unexpected ${init?.method} ${path}`);
    }) as unknown as typeof fetch;
    renderConsole(request);
    await openAction();
    expect(screen.queryByRole("button", { name: "Execute on Base" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve this action" }));
    expect(await screen.findByRole("button", { name: "Execute on Base" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Execute on Base" }));
    expect(await screen.findByText("Execution confirmed.")).toBeInTheDocument();
  });

  it("shows BLOCK without an execute control or an execution request", async () => {
    const current = actionState({ authorization: authorization("BLOCK") });
    const request = commonRequest(() => current, () => undefined);
    renderConsole(request);
    await openAction();
    expect(screen.getByRole("heading", { name: "BLOCK" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Execute on Base" })).not.toBeInTheDocument();
    expect((request as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([path]) => String(path).endsWith("/execute"))).toBe(false);
  });

  it("does not send a replayed execute request twice", async () => {
    const current = actionState({ authorization: authorization("ALLOW") });
    let completeExecution: (() => void) | undefined;
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/scar/workspaces") return Promise.resolve(json({ workspaces: [workspace] }));
      if (path.endsWith("/agents")) return Promise.resolve(json({ agents: [agentA] }));
      if (path.endsWith("/actions") && init?.method === "GET") return Promise.resolve(json({ states: [current] }));
      if (path.endsWith("/execute")) return new Promise<Response>((resolve) => { completeExecution = () => resolve(json({ result: { status: "PENDING" } })); });
      if (path.includes("/actions/action:1") && init?.method === "GET") return Promise.resolve(json({ state: current }));
      return Promise.reject(new Error(`Unexpected ${path}`));
    }) as unknown as typeof fetch;
    renderConsole(request);
    await openAction();
    const execute = screen.getByRole("button", { name: "Execute on Base" });
    fireEvent.click(execute);
    fireEvent.click(execute);
    expect((request as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([path]) => String(path).endsWith("/execute"))).toHaveLength(1);
    completeExecution?.();
  });

  it("truthfully surfaces local incident persistence, then retries the immutable server bundle", async () => {
    const pending = incident();
    let current = actionState({ authorization: authorization("ALLOW"), execution: { id: "execution:1", actionId: "action:1", authorizationId: "authorization:1", status: "SUCCEEDED", startedAt: "2026-10-07T10:01:00.000Z", completedAt: "2026-10-07T10:02:00.000Z", externalReference: "0xabc" } });
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/scar/workspaces") return json({ workspaces: [workspace] });
      if (path.endsWith("/agents")) return json({ agents: [agentA] });
      if (path.endsWith("/actions") && init?.method === "GET") return json({ states: [current] });
      if (path.endsWith("/incidents") && !path.endsWith("/retry")) { current = { ...current, incidents: [pending] }; return json({ error: { code: "MEMORY_PERSISTENCE_PENDING" }, incidentId: pending.id, memoryShared: false }, 503); }
      if (path.endsWith("/retry")) return json({ incident: pending, memoryShared: true });
      if (path.includes("/actions/") && init?.method === "GET") return json({ state: current });
      throw new Error(`Unexpected ${init?.method} ${path}`);
    }) as unknown as typeof fetch;
    renderConsole(request);
    await openAction();
    fireEvent.click(screen.getByRole("button", { name: "Report unsafe outcome" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Incident title" }), { target: { value: "Unexpected settlement behavior" } });
    fireEvent.change(screen.getByRole("textbox", { name: "What happened" }), { target: { value: "Settlement mismatch" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Outcome" }), { target: { value: "Recipient could not be verified" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Evidence reference" }), { target: { value: "operator:note" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Learned safeguard" }), { target: { value: "Block future transfers" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Mitigation" }), { target: { value: "Stop transfers" } });
    fireEvent.click(screen.getByRole("button", { name: "Save incident" }));
    expect(await screen.findByText(/persisted locally/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const retry = await screen.findByRole("button", { name: "Retry sharing" });
    fireEvent.click(retry);
    await waitFor(() => expect((request as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([path, init]) => String(path).endsWith("/retry") && init?.body === undefined)).toBe(true));
  });

  it("uses a fresh backend BLOCK for Agent B after Agent A's persisted incident", async () => {
    const agentBAction = { ...actionState({ agentId: agentB.id }).action, id: "action:2" };
    let currentB: ActionState = { ...actionState({ agentId: agentB.id }), action: agentBAction };
    const actionA = actionState({ incidents: [incident()] });
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/scar/workspaces") return json({ workspaces: [workspace] });
      if (path.endsWith("/agents")) return json({ agents: [agentA, agentB] });
      if (path.endsWith("/actions") && init?.method === "GET") return json({ states: [actionA, currentB] });
      if (path.endsWith("/evaluate")) { currentB = { ...currentB, authorization: { ...authorization("BLOCK"), id: "authorization:2", actionId: "action:2" } }; return json({ authorization: currentB.authorization }, 201); }
      if (path.includes("/actions/") && init?.method === "GET") return json({ state: currentB });
      throw new Error(`Unexpected ${path}`);
    }) as unknown as typeof fetch;
    renderConsole(request);
    await screen.findByRole("button", { name: "Open Agent B action to supplier:alpha" });
    fireEvent.click(screen.getByRole("button", { name: "Open Agent B action to supplier:alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Evaluate this action" }));
    expect(await screen.findByRole("heading", { name: "BLOCK" })).toBeInTheDocument();
    expect(screen.getByText("A persisted Scar requires this action to be blocked.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open source incident/i })).toBeInTheDocument();
  });

  it("returns to sign-in after logout and keeps cross-workspace 404 details opaque", async () => {
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/scar/workspaces") return json({ workspaces: [workspace] });
      if (path.endsWith("/agents")) return json({ agents: [agentA] });
      if (path.endsWith("/actions")) return json({ error: { code: "WORKSPACE_NOT_FOUND" } }, 404);
      throw new Error(`Unexpected ${path}`);
    }) as unknown as typeof fetch;
    const { client } = renderConsole(request);
    expect(await screen.findByText("This resource is not available in the selected workspace.")).toBeInTheDocument();
    expect(screen.queryByText("workspace:other-secret")).not.toBeInTheDocument();
    await client.signOut();
    expect(await screen.findByRole("heading", { name: "Sign in to SCAR" })).toBeInTheDocument();
  });

  it("returns to sign-in when a Bearer-authenticated API request expires", async () => {
    const request = vi.fn(async () => json({ error: { code: "UNAUTHENTICATED" } }, 401)) as unknown as typeof fetch;
    renderConsole(request);
    expect(await screen.findByRole("heading", { name: "Sign in to SCAR" })).toBeInTheDocument();
  });
});
