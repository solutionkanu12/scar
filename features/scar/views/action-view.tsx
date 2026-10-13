import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Copy,
  Database,
  FileWarning,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type { ActionState, Agent, Incident, IncidentInput } from "../scar-api";
import { AgentFace } from "../components/agent-face";
import { StatusBadge } from "../components/status-badge";

interface ActionViewProps {
  agents: Agent[];
  busy: boolean;
  copied: string | null;
  memoryPendingIncidentId: string | null;
  onApprove: () => void;
  onBack: () => void;
  onCopy: (label: string, value: string) => void;
  onEvaluate: () => void;
  onExecute: () => void;
  onOpenScar: (incidentId: string) => void;
  onRecordIncident: (input: IncidentInput) => Promise<void>;
  onRetryMemory: (incidentId: string) => Promise<void>;
  state: ActionState | null;
  workspaceIncidents: Incident[];
}

export function ActionView({ agents, busy, copied, memoryPendingIncidentId, onApprove, onBack, onCopy, onEvaluate, onExecute, onOpenScar, onRecordIncident, onRetryMemory, state, workspaceIncidents }: ActionViewProps) {
  const [incidentOpen, setIncidentOpen] = useState(false);
  if (!state) return <MissingAction onBack={onBack} />;
  const { action, authorization, approval, execution, incidents } = state;
  const agent = agents.find((item) => item.id === action.agentId);
  const pendingIncident = memoryPendingIncidentId ? incidents.find((item) => item.id === memoryPendingIncidentId) : undefined;

  return (
    <div className="content-wrap action-page">
      <button className="back-link" type="button" onClick={onBack}><ArrowLeft />Activity</button>
      <div className="action-title-row"><div><p className="eyebrow">Persisted proposed action</p><h1>{agent?.name ?? action.agentId} wants to pay {action.entityId}.</h1></div><span className="action-id">{action.id}</span></div>
      <div className="inspection-grid">
        <section className="action-summary" aria-labelledby="action-summary-title">
          <div className="agent-callout"><AgentFace icon={CircleDollarSign} shade="yellow" /><div><strong>{agent?.name ?? action.agentId}</strong><span>{agent?.role ?? "Registered SCAR agent"}</span></div></div>
          <h2 id="action-summary-title">Send</h2><p className="amount">{formatUsdc(action.amountAtomic)} USDC</p><p className="to-label">to</p>
          <div className="counterparty-block"><span className="counterparty-avatar">{action.entityId.slice(0, 2).toUpperCase()}</span><div><strong>{action.entityId}</strong><button type="button" className="hash-copy" aria-label="Copy recipient address" onClick={() => onCopy("Recipient", action.recipient)}>{shorten(action.recipient)}{copied === "Recipient" ? <Check /> : <Copy />}</button></div></div>
          <dl className="detail-list"><div><dt>Action</dt><dd>USDC transfer</dd></div><div><dt>Network</dt><dd><span className="base-dot">B</span>Base chain {action.chainId}</dd></div><div><dt>Requested</dt><dd>{new Date(action.proposedAt).toLocaleString()}</dd></div></dl>
        </section>
        <section className="decision-column" aria-label="Safety decision">
          <div className="causal-head"><span className={authorization ? "causal-node done" : "causal-node active"}><BookOpen />Memory</span><span className="causal-connector" /><span className={authorization ? "causal-node done" : "causal-node"}><ClipboardCheck />Policy</span><span className="causal-connector" /><span className={authorization ? "causal-node result" : "causal-node"}><ShieldCheck />Decision</span></div>
          {!authorization ? <ReadyDecision busy={busy} onEvaluate={onEvaluate} /> : authorization.decision === "ALLOW" ? <AllowDecision authorization={authorization} execution={execution} busy={busy} onExecute={onExecute} onReport={() => setIncidentOpen(true)} onCopy={onCopy} copied={copied} /> : authorization.decision === "REVIEW" ? <ReviewDecision authorization={authorization} approval={approval} execution={execution} busy={busy} onApprove={onApprove} onExecute={onExecute} /> : <BlockedDecision authorization={authorization} incidents={incidents} workspaceIncidents={workspaceIncidents} entityId={action.entityId} onOpenScar={onOpenScar} />}
          {pendingIncident && <MemoryPending incident={pendingIncident} busy={busy} onRetry={onRetryMemory} />}
        </section>
      </div>
      <IncidentDialog open={incidentOpen} onOpenChange={setIncidentOpen} action={state} agents={agents} saving={busy} onSave={async (input) => { await onRecordIncident(input); setIncidentOpen(false); }} />
    </div>
  );
}

function MissingAction({ onBack }: { onBack: () => void }) {
  return <div className="content-wrap action-page"><button className="back-link" type="button" onClick={onBack}><ArrowLeft />Activity</button><div className="decision-empty"><span className="memory-orbit"><BookOpen /></span><p className="eyebrow">No selected action</p><h2>Select a persisted protected action.</h2><p>SCAR only shows decisions returned by the backend.</p></div></div>;
}

function ReadyDecision({ busy, onEvaluate }: { busy: boolean; onEvaluate: () => void }) {
  return <div className="decision-empty"><span className="memory-orbit"><BookOpen /></span><p className="eyebrow">Ready to evaluate</p><h2>Look before this agent acts.</h2><p>SCAR will retrieve organizational memory and persist one deterministic authorization.</p><Button className="scar-button primary-button" disabled={busy} onClick={onEvaluate}>{busy ? <RefreshCw className="spin" /> : "Evaluate this action"}<ArrowRight /></Button><small><ShieldCheck />Execution stays paused until SCAR returns a decision.</small></div>;
}

function AllowDecision({ authorization, execution, busy, onExecute, onReport, onCopy, copied }: {
  authorization: NonNullable<ActionState["authorization"]>;
  execution: ActionState["execution"];
  busy: boolean;
  onExecute: () => void;
  onReport: () => void;
  onCopy: (label: string, value: string) => void;
  copied: string | null;
}) {
  const executionCopy = execution?.status === "PENDING" ? "Execution is pending" : execution?.status === "SUCCEEDED" ? "Transaction confirmed" : execution?.status === "FAILED" ? "Execution failed" : "Ready to execute";
  return <div className="decision-result allow-result"><div className="result-header"><span className="result-icon"><Check /></span><div><p className="eyebrow">Persisted authorization</p><h2>ALLOW</h2></div></div><p className="result-copy">{authorization.rationale}</p><div className="evidence-strip clear-evidence"><BookOpen /><div><strong>{authorization.reasonCode}</strong><span>Policy {authorization.provenance.policyVersion} evaluated {new Date(authorization.provenance.evaluatedAt).toLocaleString()}</span></div><CheckCircle2 /></div><div className="decision-divider" /><div className="execution-heading"><div><p className="eyebrow">Execution</p><h3>{executionCopy}</h3></div>{busy || execution?.status === "PENDING" ? <RefreshCw className="spin" /> : execution?.status === "SUCCEEDED" ? <CheckCircle2 className="confirmed-icon" /> : execution?.status === "FAILED" ? <TriangleAlert /> : null}</div>{!execution && <Button className="scar-button primary-button" disabled={busy} onClick={onExecute}>Execute on Base<ArrowRight /></Button>}{execution?.status === "PENDING" && <div className="transaction-progress"><span /></div>}{execution?.status === "SUCCEEDED" && <><button className="transaction-row" type="button" aria-label="Copy Base transaction reference" onClick={() => onCopy("Transaction reference", execution.externalReference ?? execution.id)}><span className="base-mark">B</span><span><strong>Base transaction</strong><small>{shorten(execution.externalReference ?? execution.id)} · Confirmed {execution.completedAt ? new Date(execution.completedAt).toLocaleString() : ""}</small></span>{copied === "Transaction reference" ? <Check /> : <Copy />}</button><Button className="scar-button incident-button" variant="outline" disabled={busy} onClick={onReport}><TriangleAlert />Report unsafe outcome</Button></>}{execution?.status === "FAILED" && <div className="blocked-note"><TriangleAlert /><div><strong>Execution failed.</strong><span>{execution.errorCode ?? "The backend recorded a failed execution. This action cannot be replayed from the UI."}</span></div></div>}</div>;
}

function ReviewDecision({ authorization, approval, execution, busy, onApprove, onExecute }: { authorization: NonNullable<ActionState["authorization"]>; approval: ActionState["approval"]; execution: ActionState["execution"]; busy: boolean; onApprove: () => void; onExecute: () => void }) {
  const executionAvailable = Boolean(approval) && !execution;
  return <div className="decision-result review-result"><div className="result-header"><span className="result-icon"><TriangleAlert /></span><div><p className="eyebrow">Persisted authorization</p><h2>REVIEW</h2></div></div><p className="result-copy">{authorization.rationale}</p><div className="evidence-strip"><ClipboardCheck /><div><strong>{approval ? "Human approval recorded" : "Human approval required"}</strong><span>{approval ? `Approved ${new Date(approval.approvedAt).toLocaleString()}` : "Execution remains paused until this action is explicitly approved."}</span></div></div><div className="decision-divider" />{!approval ? <Button className="scar-button primary-button" disabled={busy} onClick={onApprove}>Approve this action<ArrowRight /></Button> : executionAvailable ? <Button className="scar-button primary-button" disabled={busy} onClick={onExecute}>Execute on Base<ArrowRight /></Button> : <div className="blocked-note"><ShieldCheck /><div><strong>{execution?.status === "SUCCEEDED" ? "Execution confirmed." : execution?.status === "FAILED" ? "Execution failed." : "Execution is pending."}</strong><span>SCAR retains the durable execution state.</span></div></div>}</div>;
}

function BlockedDecision({ authorization, incidents, workspaceIncidents, entityId, onOpenScar }: { authorization: NonNullable<ActionState["authorization"]>; incidents: Incident[]; workspaceIncidents: Incident[]; entityId: string; onOpenScar: (incidentId: string) => void }) {
  // This is read from the persisted workspace state, not copied from an earlier
  // client flow. The deterministic authorization remains the execution truth.
  const incident = incidents[0] ?? workspaceIncidents.find((item) => item.entityId === entityId);
  return <div className="decision-result block-result"><div className="result-header"><span className="result-icon"><ShieldX /></span><div><p className="eyebrow">Persisted authorization</p><h2>BLOCK</h2></div></div><p className="result-copy">{authorization.rationale}</p>{incident && <div className="causal-memory-card"><div className="memory-source-head"><AgentFace icon={CircleDollarSign} shade="yellow" /><div><strong>{incident.sourceAgentId}</strong><span>{incident.id} · {new Date(incident.createdAt).toLocaleDateString()}</span></div><StatusBadge status={incident.severity} tone="block" /></div><h3>{incident.reason}</h3><p>{incident.outcome}</p><button type="button" onClick={() => onOpenScar(incident.id)}>Open source incident <ArrowRight /></button></div>}<div className="blocked-note"><ShieldX /><div><strong>Automatic execution prevented.</strong><span>SCAR did not send an execution request.</span></div></div></div>;
}

function MemoryPending({ incident, busy, onRetry }: { incident: Incident; busy: boolean; onRetry: (incidentId: string) => Promise<void> }) {
  return <div className="blocked-note memory-pending"><Database /><div><strong>Local incident persisted; organizational memory is not yet shared.</strong><span>{incident.id} is waiting for immutable delivery to Sibyl.</span></div><Button className="scar-button quiet-button" variant="outline" disabled={busy} onClick={() => void onRetry(incident.id)}>Retry sharing</Button></div>;
}

export function IncidentDialog({ open, onOpenChange, action, agents, saving, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; action: ActionState; agents: Agent[]; saving: boolean; onSave: (input: IncidentInput) => Promise<void> }) {
  const [formError, setFormError] = useState<string | null>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="incident-dialog" showCloseButton><DialogHeader><span className="dialog-symbol"><FileWarning /></span><p className="eyebrow">Create organizational Scar</p><DialogTitle>What should every agent learn from this?</DialogTitle><DialogDescription>SCAR persists the local incident first, then shares the server-built immutable bundle with organizational memory.</DialogDescription></DialogHeader><div className="incident-context"><span className="base-mark">B</span><div><strong>{formatUsdc(action.action.amountAtomic)} USDC to {action.action.entityId}</strong><span>Action {action.action.id}</span></div><CheckCircle2 /></div><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const selected = agents.filter((agent) => data.has(`agent-${agent.id}`)).map((agent) => agent.id); if (selected.length === 0) { setFormError("Select at least one registered agent for the safeguard."); return; } setFormError(null); void onSave({ entity: { name: action.action.entityId, externalIdentifier: action.action.recipient, type: "COUNTERPARTY" }, context: String(data.get("context")), outcome: String(data.get("outcome")), severity: String(data.get("severity")) as IncidentInput["severity"], reason: String(data.get("reason")), mitigation: String(data.get("mitigation")), evidence: [{ kind: "OPERATOR_NOTE", reference: String(data.get("evidence")), observedAt: new Date().toISOString() }], safeguard: { requiredResponse: String(data.get("response")) as "REVIEW" | "BLOCK", reason: String(data.get("safeguard")), scopeAgentIds: selected } }).catch((cause) => setFormError(cause instanceof Error ? cause.message : "The incident could not be recorded.")); }}><div className="form-grid"><label><span>Incident title</span><Input className="scar-input" name="reason" required /></label><label><span>Severity</span><select className="scar-select" name="severity" defaultValue="HIGH"><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select></label><label className="full-field"><span>What happened</span><Textarea className="scar-textarea" name="context" required /></label><label className="full-field"><span>Outcome</span><Textarea className="scar-textarea" name="outcome" required /></label><label className="full-field"><span>Evidence reference</span><Input className="scar-input" name="evidence" required /></label><label className="full-field safeguard-field"><span>Learned safeguard</span><Textarea aria-label="Learned safeguard" className="scar-textarea" name="safeguard" required /><small><ShieldCheck />Choose the real registered agents this safeguard covers.</small></label><label><span>Required response</span><select className="scar-select" name="response" defaultValue="BLOCK"><option value="BLOCK">Block</option><option value="REVIEW">Review</option></select></label><label><span>Mitigation</span><Input className="scar-input" name="mitigation" required /></label><fieldset className="full-field incident-agent-scope"><legend>Safeguard scope</legend>{agents.map((agent) => <label key={agent.id}><input name={`agent-${agent.id}`} type="checkbox" defaultChecked />{agent.name}</label>)}</fieldset></div>{formError && <p className="form-error" role="alert">{formError}</p>}<DialogFooter className="dialog-actions"><Button className="scar-button quiet-button" variant="ghost" type="button" onClick={() => onOpenChange(false)}>Cancel</Button><Button className="scar-button primary-button" disabled={saving} type="submit"><Database />{saving ? "Saving…" : "Save incident"}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function formatUsdc(amountAtomic: string): string { const amount = BigInt(amountAtomic); const unit = BigInt(1_000_000); const whole = amount / unit; const fraction = (amount % unit).toString().padStart(6, "0").replace(/0+$/, ""); return fraction ? `${whole}.${fraction}` : whole.toString(); }
function shorten(value: string) { return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value; }
