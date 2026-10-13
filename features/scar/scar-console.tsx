"use client";

import { Check, LoaderCircle, Plus, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { ScarAuthProvider, useScarAuth, type ScarAuthClient } from "./auth";
import { ScarApiClient, ScarApiError, type ActionState, type Agent, type AgentCredentialOperation, type IncidentInput, type LocallyProvisionedAgentCredential, type Workspace } from "./scar-api";
import { AppShell } from "./components/app-shell";
import type { View } from "./types";
import { ActionView } from "./views/action-view";
import { ActivityView } from "./views/activity-view";
import { AgentsView } from "./views/agents-view";
import { ScarDetailView } from "./views/scar-detail-view";
import { ScarsView } from "./views/scars-view";

export function ScarConsole({ onHome, authClient, request }: {
  onHome: () => void;
  /** Test-only injection keeps browser auth and HTTP boundaries mockable. */
  authClient?: ScarAuthClient;
  request?: typeof fetch;
}) {
  return <ScarAuthProvider client={authClient}><ScarConsoleSession onHome={onHome} request={request} /></ScarAuthProvider>;
}

function ScarConsoleSession({ onHome, request }: { onHome: () => void; request?: typeof fetch }) {
  const auth = useScarAuth();
  if (auth.status === "loading") return <ConsoleLoading label="Restoring authenticated session" />;
  if (auth.status === "configuration-error") return <AuthPanel configurationError={auth.error} />;
  if (!auth.session) return <AuthPanel />;
  return <WorkspaceConsole onHome={onHome} request={request} />;
}

function WorkspaceConsole({ onHome, request }: { onHome: () => void; request?: typeof fetch }) {
  const auth = useScarAuth();
  const api = useMemo(() => new ScarApiClient(
    () => auth.session?.access_token ?? null,
    () => auth.expire(),
    request,
  ), [auth, request]);
  const [view, setView] = useState<View>("activity");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [states, setStates] = useState<ActionState[]>([]);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [error, setError] = useState<ScarApiError | Error | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [credentialProvisionOpen, setCredentialProvisionOpen] = useState(false);
  const [provisionedCredential, setProvisionedCredential] = useState<LocallyProvisionedAgentCredential | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [memoryPendingIncidentId, setMemoryPendingIncidentId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  const inFlight = useRef(new Set<string>());

  const loadWorkspaces = useCallback(async () => {
    const response = await api.listWorkspaces();
    setWorkspaces(response.workspaces);
    setActiveWorkspaceId((current) =>
      response.workspaces.some((workspace) => workspace.id === current)
        ? current
        : response.workspaces[0]?.id ?? null,
    );
  }, [api]);

  useEffect(() => {
    let live = true;
    void loadWorkspaces().catch((cause) => {
      if (live) setError(asError(cause));
    }).finally(() => {
      if (live) setInitializing(false);
    });
    return () => { live = false; };
  }, [loadWorkspaces]);

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const loadWorkspaceData = useCallback(async (workspaceId: string) => {
    setWorkspaceLoading(true);
    setError(null);
    const [agentResult, actionResult] = await Promise.allSettled([
      api.listAgents(workspaceId),
      api.listActionStates(workspaceId),
    ]);
    if (agentResult.status === "fulfilled") setAgents(agentResult.value.agents);
    if (actionResult.status === "fulfilled") {
      setStates(actionResult.value.states);
      setSelectedActionId((current) =>
        actionResult.value.states.some((item) => item.action.id === current)
          ? current
          : actionResult.value.states[0]?.action.id ?? null,
      );
    }
    const failure = agentResult.status === "rejected" ? agentResult.reason : actionResult.status === "rejected" ? actionResult.reason : null;
    if (failure) setError(asError(failure));
    setWorkspaceLoading(false);
  }, [api]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setAgents([]);
      setStates([]);
      return;
    }
    void loadWorkspaceData(activeWorkspaceId);
  }, [activeWorkspaceId, loadWorkspaceData]);

  useEffect(() => {
    contentRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [view]);

  const selectedState = states.find((state) => state.action.id === selectedActionId) ?? null;
  useEffect(() => {
    if (!activeWorkspaceId || !selectedState || selectedState.execution?.status !== "PENDING") return;
    const timer = window.setInterval(() => {
      void refreshAction(activeWorkspaceId, selectedState.action.id);
    }, 3_000);
    return () => window.clearInterval(timer);
  // Only polls the durable state while the backend reports an in-progress execution.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, selectedState?.action.id, selectedState?.execution?.status]);

  async function refreshAction(workspaceId: string, actionId: string) {
    try {
      const response = await api.getActionState(workspaceId, actionId);
      setStates((current) => {
        const remaining = current.filter((state) => state.action.id !== actionId);
        return [response.state, ...remaining];
      });
      return response.state;
    } catch (cause) {
      setError(asError(cause));
      return null;
    }
  }

  async function run(key: string, operation: () => Promise<void>) {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setBusyKey(key);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(asError(cause));
      throw cause;
    } finally {
      inFlight.current.delete(key);
      setBusyKey(null);
    }
  }

  function selectWorkspace(workspaceId: string) {
    setActiveWorkspaceId(workspaceId);
    setView("activity");
    setMobileNav(false);
    setSelectedIncidentId(null);
  }

  async function createWorkspace(input: { name: string; kind: Workspace["kind"] }) {
    await run("workspace", async () => {
      const response = await api.createWorkspace(input);
      await loadWorkspaces();
      setActiveWorkspaceId(response.workspace.id);
    });
  }

  async function registerAgent(input: Omit<Agent, "id">) {
    if (!activeWorkspaceId) return;
    await run("register-agent", async () => {
      const registered = await api.registerAgent(activeWorkspaceId, {
        ...input,
        id: `agent:${crypto.randomUUID()}`,
      });
      // Read after write: what is displayed is the persisted backend record.
      const fetched = await api.getAgent(activeWorkspaceId, registered.agent.id);
      setAgents((current) => [...current.filter((agent) => agent.id !== fetched.agent.id), fetched.agent]);
      setRegisterOpen(false);
    });
  }

  async function provisionCredential(input: { agentId: string; allowedOperations: AgentCredentialOperation[] }) {
    if (!activeWorkspaceId) return;
    await run(`provision-credential:${input.agentId}`, async () => {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
      const credential = await api.issueAgentCredential(activeWorkspaceId, input.agentId, {
        allowedOperations: input.allowedOperations,
        expiresAt,
      });
      setProvisionedCredential(credential);
    });
  }

  function setCredentialProvisioningOpen(open: boolean) {
    setCredentialProvisionOpen(open);
    if (!open) setProvisionedCredential(null);
  }

  async function proposeAction(input: Omit<ActionState["action"], "id" | "proposedAt">) {
    if (!activeWorkspaceId) return;
    await run("propose-action", async () => {
      const proposed = await api.proposeAction(activeWorkspaceId, input);
      const state = await refreshAction(activeWorkspaceId, proposed.action.id);
      if (!state) throw new Error("The proposed action could not be loaded from durable state.");
      setSelectedActionId(state.action.id);
      setProposeOpen(false);
      setView("action");
    });
  }

  async function evaluate() {
    if (!activeWorkspaceId || !selectedState) return;
    await run(`evaluate:${selectedState.action.id}`, async () => {
      await api.evaluateAction(activeWorkspaceId, selectedState.action.id);
      await refreshAction(activeWorkspaceId, selectedState.action.id);
    });
  }

  async function approve() {
    if (!activeWorkspaceId || !selectedState?.authorization) return;
    const authorizationId = selectedState.authorization.id;
    const actionId = selectedState.action.id;
    await run(`approve:${actionId}`, async () => {
      await api.approveAction(activeWorkspaceId, actionId, authorizationId);
      await refreshAction(activeWorkspaceId, actionId);
    });
  }

  async function execute() {
    if (!activeWorkspaceId || !selectedState) return;
    await run(`execute:${selectedState.action.id}`, async () => {
      await api.executeAction(activeWorkspaceId, selectedState.action.id, selectedState.approval?.id);
      await refreshAction(activeWorkspaceId, selectedState.action.id);
    });
  }

  async function recordIncident(input: IncidentInput) {
    if (!activeWorkspaceId || !selectedState) return;
    const actionId = selectedState.action.id;
    try {
      await run(`incident:${actionId}`, async () => {
        await api.recordIncident(activeWorkspaceId, actionId, input);
        await refreshAction(activeWorkspaceId, actionId);
      });
    } catch (cause) {
      const apiError = asError(cause);
      if (apiError instanceof ScarApiError && apiError.code === "MEMORY_PERSISTENCE_PENDING" && apiError.incidentId) {
        await refreshAction(activeWorkspaceId, actionId);
        setMemoryPendingIncidentId(apiError.incidentId);
        throw new Error("The incident was persisted locally, but organizational memory has not been shared yet. Retry uses the immutable server-side bundle.");
      }
      throw cause;
    }
  }

  async function retryMemory(incidentId: string) {
    if (!activeWorkspaceId || !selectedState) return;
    await run(`retry-incident:${incidentId}`, async () => {
      await api.retryIncident(activeWorkspaceId, selectedState.action.id, incidentId);
      setMemoryPendingIncidentId(null);
      await refreshAction(activeWorkspaceId, selectedState.action.id);
    });
  }

  function copyValue(label: string, value: string) {
    if (navigator.clipboard) void navigator.clipboard.writeText(value).catch(() => undefined);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1_200);
  }

  if (initializing) return <ConsoleLoading label="Loading accessible workspaces" />;
  if (workspaces.length === 0) return <WorkspaceSetup error={error} busy={busyKey === "workspace"} onCreate={createWorkspace} onSignOut={() => void auth.signOut()} />;
  if (!activeWorkspace) return <ConsoleLoading label="Selecting workspace" />;
  const incidents = states.flatMap((state) => state.incidents);
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId);
  const selectedIncidentState = states.find((state) => state.action.id === selectedIncident?.relatedActionId);
  const selectedIncidentAgent = agents.find((agent) => agent.id === selectedIncident?.sourceAgentId);

  return <><AppShell contentRef={contentRef} hasScar={incidents.length > 0} mobileNav={mobileNav} onHome={onHome} onNavigate={(next) => { setView(next); setMobileNav(false); }} onSignOut={() => void auth.signOut()} onWorkspaceChange={selectWorkspace} onToggleMobileNav={() => setMobileNav((current) => !current)} view={view} workspace={activeWorkspace} workspaces={workspaces}>{workspaceLoading ? <ConsoleLoading label="Loading durable workspace state" /> : <>{error && <ApiFailure error={error} onRetry={() => void loadWorkspaceData(activeWorkspace.id)} onActivateAccess={error instanceof ScarApiError && error.code === "ROLE_FORBIDDEN" ? () => { void run("activate-access", async () => { await api.assignWorkspaceRole(activeWorkspace.id, auth.session!.user.id, "ADMIN"); await loadWorkspaceData(activeWorkspace.id); }).catch(() => undefined); } : undefined} />}{view === "activity" && <ActivityView states={states} agents={agents} onOpenAction={(actionId) => { setSelectedActionId(actionId); setView("action"); }} onPropose={() => setProposeOpen(true)} />}{view === "agents" && <AgentsView agents={agents} onOpenAgent={(agentId) => { const state = states.find((item) => item.action.agentId === agentId); if (state) { setSelectedActionId(state.action.id); setView("action"); } }} onProvisionCredential={() => setCredentialProvisioningOpen(true)} onRegister={() => setRegisterOpen(true)} />}{view === "scars" && <ScarsView incidents={incidents} onOpenScar={(incidentId) => { setSelectedIncidentId(incidentId); setView("scar-detail"); }} />}{view === "action" && <ActionView agents={agents} busy={busyKey !== null} copied={copied} memoryPendingIncidentId={memoryPendingIncidentId} onBack={() => setView("activity")} onCopy={copyValue} onEvaluate={() => void evaluate().catch(() => undefined)} onApprove={() => void approve().catch(() => undefined)} onExecute={() => void execute().catch(() => undefined)} onOpenScar={(incidentId) => { setSelectedIncidentId(incidentId); setView("scar-detail"); }} onRecordIncident={recordIncident} onRetryMemory={retryMemory} state={selectedState} workspaceIncidents={incidents} />}{view === "scar-detail" && selectedIncident && <ScarDetailView incident={selectedIncident} state={selectedIncidentState} agent={selectedIncidentAgent} onBack={() => setView("scars")} onOpenAction={() => { setSelectedActionId(selectedIncident.relatedActionId); setView("action"); }} onCopy={copyValue} copied={copied} />}</>}</AppShell><RegisterAgentDialog open={registerOpen} onOpenChange={setRegisterOpen} saving={busyKey === "register-agent"} onSave={registerAgent} /><CredentialProvisionDialog agents={agents} open={credentialProvisionOpen} onOpenChange={setCredentialProvisioningOpen} onCopy={copyValue} onProvision={provisionCredential} provisioned={provisionedCredential} saving={busyKey?.startsWith("provision-credential:") ?? false} /><ProposeActionDialog open={proposeOpen} onOpenChange={setProposeOpen} agents={agents} saving={busyKey === "propose-action"} onSave={proposeAction} /><div className={`copy-toast ${copied ? "copy-toast-show" : ""}`} role="status" aria-live="polite"><Check />{copied ? `${copied} copied` : "Copied"}</div></>;
}

function AuthPanel({ configurationError }: { configurationError?: string | null }) {
  const auth = useScarAuth();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [message, setMessage] = useState<string | null>(configurationError ?? null);
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="scar-auth-title"><p className="eyebrow">Shared safety memory</p><h1 id="scar-auth-title">Sign in to SCAR</h1><p>Authenticated workspace access keeps every action, decision, and Scar in its rightful organization.</p>{configurationError ? <p className="form-error" role="alert">{configurationError}</p> : <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const email = String(data.get("email")); const password = String(data.get("password")); void (mode === "sign-in" ? auth.signIn(email, password).then((error) => setMessage(error)) : auth.signUp(email, password).then((result) => setMessage(result === "signed-in" ? null : result === "confirm-email" ? "Check your email to confirm this account, then sign in." : result))); }}><label><span>Email</span><Input className="scar-input" name="email" type="email" autoComplete="email" required /></label><label><span>Password</span><Input className="scar-input" name="password" type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} required /></label>{message && <p className="form-error" role="alert">{message}</p>}<Button className="scar-button primary-button" type="submit">{mode === "sign-in" ? "Sign in" : "Create account"}</Button></form>} {!configurationError && <button className="auth-switch" type="button" onClick={() => { setMode((current) => current === "sign-in" ? "sign-up" : "sign-in"); setMessage(null); }}>{mode === "sign-in" ? "Need an account? Create one" : "Already have an account? Sign in"}</button>}</section></main>;
}

function WorkspaceSetup({ error, busy, onCreate, onSignOut }: { error: Error | null; busy: boolean; onCreate: (input: { name: string; kind: Workspace["kind"] }) => Promise<void>; onSignOut: () => void }) {
  const [formError, setFormError] = useState<string | null>(null);
  return <main className="auth-shell"><section className="auth-card" aria-labelledby="workspace-title"><p className="eyebrow">Welcome to SCAR</p><h1 id="workspace-title">Create your first workspace</h1><p>Workspace membership and roles are verified by SCAR’s backend on every request.</p>{error && <ApiFailure error={error} />}{formError && <p className="form-error" role="alert">{formError}</p>}<form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onCreate({ name: String(data.get("name")), kind: String(data.get("kind")) as Workspace["kind"] }).catch((cause) => setFormError(messageForError(asError(cause)))); }}><label><span>Workspace name</span><Input className="scar-input" name="name" maxLength={120} required /></label><label><span>Workspace type</span><select className="scar-select" name="kind" defaultValue="PERSONAL"><option value="PERSONAL">Personal</option><option value="ORGANIZATION">Organization</option></select></label><Button className="scar-button primary-button" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Plus />}Create workspace</Button></form><button className="auth-switch" type="button" onClick={onSignOut}>Sign out</button></section></main>;
}

function RegisterAgentDialog({ open, onOpenChange, saving, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; saving: boolean; onSave: (input: Omit<Agent, "id">) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="incident-dialog"><DialogHeader><DialogTitle>Register an agent</DialogTitle><DialogDescription>The backend persists the agent and validates it before it can propose protected work.</DialogDescription></DialogHeader><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onSave({ name: String(data.get("name")), role: String(data.get("role")), status: "ACTIVE", permissions: ["USDC_TRANSFER"] }).catch((cause) => setError(messageForError(asError(cause)))); }}><div className="form-grid"><label className="full-field"><span>Agent name</span><Input className="scar-input" name="name" maxLength={120} required /></label><label className="full-field"><span>Role</span><Input className="scar-input" name="role" maxLength={240} required /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<DialogFooter className="dialog-actions"><Button type="button" variant="ghost" className="scar-button quiet-button" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={saving} className="scar-button primary-button">{saving ? "Registering…" : "Register agent"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function CredentialProvisionDialog({ agents, onCopy, onOpenChange, onProvision, open, provisioned, saving }: { agents: Agent[]; onCopy: (label: string, value: string) => void; onOpenChange: (open: boolean) => void; onProvision: (input: { agentId: string; allowedOperations: AgentCredentialOperation[] }) => Promise<void>; open: boolean; provisioned: LocallyProvisionedAgentCredential | null; saving: boolean }) {
  const [formError, setFormError] = useState<string | null>(null);
  const operations: AgentCredentialOperation[] = ["PROPOSE_ACTION", "EVALUATE_ACTION", "EXECUTE_ACTION", "READ_ACTION"];
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="incident-dialog"><DialogHeader><DialogTitle>{provisioned ? "Copy agent credential" : "Provision agent credential"}</DialogTitle><DialogDescription>{provisioned ? "Copy this bearer credential now. It is held only in this browser tab and is cleared when you close this dialog." : "SCAR will store only a peppered hash. Choose the least privilege operations this agent needs."}</DialogDescription></DialogHeader>{provisioned ? <><label><span>Bearer credential</span><textarea className="scar-input" aria-label="Bearer credential" readOnly value={provisioned.token} rows={4} /></label><DialogFooter className="dialog-actions"><Button type="button" variant="ghost" className="scar-button quiet-button" onClick={() => onOpenChange(false)}>Done</Button><Button type="button" className="scar-button primary-button" onClick={() => onCopy("Credential", provisioned.token)}>Copy credential</Button></DialogFooter></> : <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const allowedOperations = operations.filter((operation) => data.get(operation) === "on"); if (allowedOperations.length === 0) { setFormError("Select at least one allowed operation."); return; } setFormError(null); void onProvision({ agentId: String(data.get("agentId")), allowedOperations }).catch((cause) => setFormError(messageForError(asError(cause)))); }}><label><span>Agent</span><select className="scar-select" name="agentId" required>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><fieldset><legend>Allowed operations</legend>{operations.map((operation) => <label key={operation}><input type="checkbox" name={operation} defaultChecked={operation === "PROPOSE_ACTION"} />{operation.replaceAll("_", " ")}</label>)}</fieldset>{formError && <p className="form-error" role="alert">{formError}</p>}<DialogFooter className="dialog-actions"><Button type="button" variant="ghost" className="scar-button quiet-button" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={saving} className="scar-button primary-button">{saving ? "Provisioning…" : "Provision credential"}</Button></DialogFooter></form>}</DialogContent></Dialog>;
}

function ProposeActionDialog({ open, onOpenChange, agents, saving, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; agents: Agent[]; saving: boolean; onSave: (input: Omit<ActionState["action"], "id" | "proposedAt">) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="incident-dialog"><DialogHeader><DialogTitle>Propose protected action</DialogTitle><DialogDescription>SCAR will persist this proposal before a separate evaluation retrieves memory and decides it.</DialogDescription></DialogHeader><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void onSave({ agentId: String(data.get("agentId")), actionType: "USDC_TRANSFER", amountAtomic: String(data.get("amountAtomic")), entityId: String(data.get("entityId")), recipient: String(data.get("recipient")), chainId: Number(data.get("chainId")) }).catch((cause) => setError(messageForError(asError(cause)))); }}><div className="form-grid"><label className="full-field"><span>Agent</span><select className="scar-select" name="agentId" required>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><label><span>Amount (atomic USDC)</span><Input className="scar-input" name="amountAtomic" inputMode="numeric" pattern="[0-9]+" required /></label><label><span>Chain ID</span><Input className="scar-input" name="chainId" inputMode="numeric" defaultValue="84532" required /></label><label className="full-field"><span>Counterparty identifier</span><Input className="scar-input" name="entityId" maxLength={128} required /></label><label className="full-field"><span>Recipient address</span><Input className="scar-input" name="recipient" pattern="0x[0-9a-fA-F]{40}" required /></label></div>{error && <p className="form-error" role="alert">{error}</p>}<DialogFooter className="dialog-actions"><Button type="button" variant="ghost" className="scar-button quiet-button" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={saving} className="scar-button primary-button">{saving ? "Proposing…" : "Propose action"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function ConsoleLoading({ label }: { label: string }) { return <main className="auth-shell"><div className="checking-panel" role="status" aria-live="polite"><LoaderCircle className="spin" /><h1>{label}</h1><p className="result-copy">SCAR is waiting for authoritative backend state.</p></div></main>; }
function ApiFailure({ error, onRetry, onActivateAccess }: { error: Error; onRetry?: () => void; onActivateAccess?: () => void }) { return <div className="api-failure" role="alert"><ShieldAlert /><div><strong>{messageForError(error)}</strong><span>{error instanceof ScarApiError ? `SCAR response: ${error.status} ${error.code}` : "No optimistic state was applied."}</span></div>{onRetry && <Button className="scar-button quiet-button" variant="outline" onClick={onRetry}>Retry</Button>}{onActivateAccess && <Button className="scar-button quiet-button" variant="outline" onClick={onActivateAccess}>Activate operational access</Button>}</div>; }
function asError(cause: unknown): ScarApiError | Error { return cause instanceof Error ? cause : new Error("REQUEST_FAILED"); }
function messageForError(error: Error): string { if (!(error instanceof ScarApiError)) return "SCAR could not complete this request."; switch (error.code) { case "UNAUTHENTICATED": return "Your session has expired. Sign in again."; case "ROLE_FORBIDDEN": return "Your authenticated account needs an explicit workspace role for this operation."; case "WORKSPACE_NOT_FOUND": case "ACTION_NOT_FOUND": case "AGENT_NOT_FOUND": return "This resource is not available in the selected workspace."; case "RATE_LIMITED": return "Too many requests. Wait a minute and retry."; case "DEPENDENCY_UNAVAILABLE": case "MULTI_WORKSPACE_OPERATIONS_DISABLED": return "A required SCAR dependency is unavailable. No action was completed."; case "EXECUTION_CONFIGURATION_DISABLED": return "Execution is not configured for this workspace."; case "REVIEW_AUTHORIZATION_REQUIRED": return "A persisted REVIEW authorization and human approval are required."; case "MEMORY_PERSISTENCE_PENDING": return "The incident is local only; organizational memory sharing is pending."; default: return `SCAR rejected this request (${error.code}).`; } }
