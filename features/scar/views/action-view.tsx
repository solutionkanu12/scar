import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Copy,
  Database,
  FileWarning,
  Fingerprint,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { AgentFace } from "../components/agent-face";
import { StatusBadge } from "../components/status-badge";
import type { FlowEvent, FlowStep } from "../types";

interface ActionViewProps {
  copied: string | null;
  onBack: () => void;
  onCopy: (label: string, value: string) => void;
  onFlowEvent: (event: FlowEvent) => void;
  onOpenScar: () => void;
  onReport: () => void;
  step: FlowStep;
}

export function ActionView({ step, onFlowEvent, onBack, onReport, onOpenScar, onCopy, copied }: ActionViewProps) {
  const loading = step === "loading";
  const recall = ["fresh", "checking-recall", "blocked"].includes(step);
  const checking = ["checking-first", "checking-recall"].includes(step);
  const allowed = ["allowed", "executing", "confirmed", "scar-saved", "execution-failed"].includes(step);
  const blocked = step === "blocked";
  const review = step === "review";
  const halted = ["sibyl-unavailable", "invalid-action", "unauthorized-agent"].includes(step);
  const resolved = allowed || blocked || review || halted;
  const agentName = recall ? "Procurement Agent" : "Treasury Agent";
  const amount = recall ? "4 USDC" : "1 USDC";
  const AgentIcon = recall ? PackageCheck : CircleDollarSign;

  return (
    <div className="content-wrap action-page">
      <button className="back-link" type="button" onClick={onBack}><ArrowLeft />Activity</button>
      {recall && <div className="fresh-session-inline"><span><RefreshCw /></span><div><strong>Fresh agent session</strong><p>New runtime context. Organizational memory restored from Sibyl.</p></div><StatusBadge status="SIBYL CONNECTED" tone="memory" /></div>}
      <div className="action-title-row"><div><p className="eyebrow">Proposed action</p><h1>{agentName} wants to pay Supplier Alpha.</h1></div><span className="action-id">ACT-{recall ? "219" : "218"}</span></div>

      <div className="inspection-grid">
        <section className="action-summary" aria-labelledby="action-summary-title">
          <div className="agent-callout"><AgentFace icon={AgentIcon} shade={recall ? "coral" : "yellow"} /><div><strong>{agentName}</strong><span>{recall ? "Supplier payments" : "Company treasury"}</span></div></div>
          <h2 id="action-summary-title">Send</h2><p className="amount">{amount}</p><p className="to-label">to</p>
          <div className="counterparty-block"><span className="counterparty-avatar">SA</span><div><strong>Supplier Alpha</strong><button type="button" className="hash-copy" aria-label="Copy Supplier Alpha address" onClick={() => onCopy("Address", "0x72A8...91C2")}>0x72A8...91C2{copied === "Address" ? <Check /> : <Copy />}</button></div></div>
          <dl className="detail-list"><div><dt>Action</dt><dd>USDC transfer</dd></div><div><dt>Network</dt><dd><span className="base-dot">B</span>Base</dd></div><div><dt>Requested</dt><dd>Sep 9, 21:04</dd></div></dl>
        </section>

        <section className="decision-column" aria-label="Safety decision">
          <div className="causal-head"><span className={checking ? "causal-node active" : "causal-node done"}>{checking ? <RefreshCw className="spin" /> : <Database />}Memory</span><span className="causal-connector" /><span className={resolved ? "causal-node done" : "causal-node"}><ClipboardCheck />Policy</span><span className="causal-connector" /><span className={resolved ? "causal-node result" : "causal-node"}><ShieldCheck />Decision</span></div>

          {(step === "initial" || step === "fresh") && <div className="decision-empty"><span className="memory-orbit"><BookOpen /></span><p className="eyebrow">Ready to check</p><h2>Look before this agent acts.</h2><p>Scar will search organizational memory, apply policy, and return one clear decision.</p><Button className="scar-button primary-button" onClick={() => onFlowEvent("check")}>Check this action<ArrowRight /></Button><small><ShieldCheck />Execution stays paused until the check completes.</small></div>}
          {loading && <LoadingDecision />}
          {checking && <MemoryChecking recall={recall} />}
          {allowed && <AllowedDecision step={step} onFlowEvent={onFlowEvent} onReport={onReport} onOpenScar={onOpenScar} onCopy={onCopy} copied={copied} />}
          {blocked && <BlockedDecision onOpenScar={onOpenScar} />}
          {review && <ReviewDecision onApprove={() => onFlowEvent("approve")} />}
          {halted && <HaltedDecision step={step} />}
        </section>
      </div>
    </div>
  );
}

function LoadingDecision() {
  return (
    <div className="checking-panel" role="status" aria-live="polite">
      <div className="checking-illustration"><span className="search-ring ring-one" /><span className="search-ring ring-two" /><RefreshCw className="spin" /></div>
      <p className="eyebrow">Loading protected activity</p>
      <h2>Loading Scar</h2>
      <p className="result-copy">Preparing protected activity.</p>
    </div>
  );
}

function MemoryChecking({ recall }: { recall: boolean }) {
  return (
    <div className="checking-panel" role="status" aria-live="polite">
      <div className="checking-illustration"><span className="search-ring ring-one" /><span className="search-ring ring-two" /><BookOpen /></div>
      <p className="eyebrow">Checking organizational memory</p><h2>{recall ? "Looking for inherited risk..." : "Looking for related incidents..."}</h2><div className="checking-progress"><span /></div>
      <ul><li className="complete"><Check />Counterparty matched</li><li className={recall ? "complete" : "active"}>{recall ? <Check /> : <RefreshCw className="spin" />}Sibyl Memory queried</li><li className={recall ? "active" : "waiting"}><RefreshCw className={recall ? "spin" : ""} />Static policy evaluation</li></ul>
    </div>
  );
}

function AllowedDecision({ step, onFlowEvent, onReport, onOpenScar, onCopy, copied }: { step: FlowStep; onFlowEvent: (event: FlowEvent) => void; onReport: () => void; onOpenScar: () => void; onCopy: (label: string, value: string) => void; copied: string | null }) {
  const isExecuting = step === "executing";
  const isConfirmed = ["confirmed", "scar-saved"].includes(step);
  const isScarSaved = step === "scar-saved";
  const isFailed = step === "execution-failed";
  return (
    <div className="decision-result allow-result">
      <div className="result-header"><span className="result-icon"><Check /></span><div><p className="eyebrow">Authorization</p><h2>ALLOW</h2></div></div>
      <p className="result-copy">No related incidents were found. The action also passed current policy.</p>
      <div className="evidence-strip clear-evidence"><BookOpen /><div><strong>No relevant Scars</strong><span>Sibyl search completed at 21:04</span></div><CheckCircle2 /></div>
      <div className="decision-divider" />
      <div className="execution-heading"><div><p className="eyebrow">Execution</p><h3>{isExecuting ? "Sending on Base..." : isConfirmed ? "Transaction confirmed" : isFailed ? "Transaction failed" : "Ready to execute"}</h3></div>{isExecuting && <RefreshCw className="spin" />}{isConfirmed && <CheckCircle2 className="confirmed-icon" />}{isFailed && <TriangleAlert />}</div>
      {step === "allowed" && <Button className="scar-button primary-button" onClick={() => onFlowEvent("execute")}>Execute on Base<ArrowRight /></Button>}
      {isExecuting && <div className="transaction-progress"><span /></div>}
      {isFailed && <><div className="blocked-note"><TriangleAlert /><div><strong>Authorization remains ALLOW.</strong><span>Execution failed separately. No transaction was confirmed.</span></div></div><Button className="scar-button quiet-button failure-retry" variant="outline" onClick={() => onFlowEvent("retry")}>Retry execution</Button></>}
      {isConfirmed && <><button className="transaction-row" type="button" aria-label="Copy Base transaction hash" onClick={() => onCopy("Transaction hash", "0x8A...92F")}><span className="base-mark">B</span><span><strong>Base transaction</strong><small>0x8A...92F · Confirmed 21:05</small></span>{copied === "Transaction hash" ? <Check /> : <Copy />}</button>{!isScarSaved && <Button className="scar-button incident-button" variant="outline" onClick={onReport}><TriangleAlert />Report unsafe outcome</Button>}</>}
      {isScarSaved && <div className="scar-created-panel"><span className="scar-created-icon"><Fingerprint /></span><div><p className="eyebrow">Saved to Sibyl Memory</p><h3>Scar 0042 now protects future agents.</h3><p>Treasury and Procurement will inherit this safeguard.</p></div><button type="button" onClick={onOpenScar}>View Scar <ChevronRight /></button><Button className="scar-button dark-button" onClick={() => onFlowEvent("start-fresh-session")}>Start a fresh agent session<ArrowRight /></Button></div>}
    </div>
  );
}

function ReviewDecision({ onApprove }: { onApprove: () => void }) {
  return (
    <div className="decision-result review-result">
      <div className="result-header"><span className="result-icon"><TriangleAlert /></span><div><p className="eyebrow">Authorization</p><h2>REVIEW</h2></div></div>
      <p className="result-copy">Human approval required.</p>
      <div className="evidence-strip"><ClipboardCheck /><div><strong>Policy requires operator review</strong><span>Execution remains paused until this action is explicitly approved.</span></div></div>
      <div className="decision-divider" />
      <Button className="scar-button primary-button" onClick={onApprove}>Approve this action<ArrowRight /></Button>
    </div>
  );
}

function HaltedDecision({ step }: { step: FlowStep }) {
  const copy = step === "sibyl-unavailable"
    ? { heading: "Memory unavailable", explanation: "Protected execution remains paused.", detail: "Scar could not verify required organizational memory." }
    : step === "invalid-action"
      ? { heading: "Invalid action", explanation: "This request cannot be evaluated.", detail: "The proposed action does not match the supported action schema." }
      : { heading: "Unauthorized agent", explanation: "This agent cannot propose protected actions.", detail: "The agent identity or permission scope could not be verified." };

  return (
    <div className="decision-result block-result" role="status">
      <div className="result-header"><span className="result-icon"><ShieldX /></span><div><p className="eyebrow">Action stopped</p><h2>{copy.heading}</h2></div></div>
      <p className="result-copy">{copy.explanation}</p>
      <div className="blocked-note"><ShieldX /><div><strong>Execution unavailable.</strong><span>{copy.detail}</span></div></div>
    </div>
  );
}

function BlockedDecision({ onOpenScar }: { onOpenScar: () => void }) {
  return (
    <div className="decision-result block-result">
      <div className="result-header"><span className="result-icon"><ShieldX /></span><div><p className="eyebrow">Authorization</p><h2>BLOCK</h2></div></div>
      <p className="result-copy">A previous agent encountered a critical incident with this counterparty.</p>
      <div className="causal-memory-card"><div className="memory-source-head"><AgentFace icon={CircleDollarSign} shade="yellow" /><div><strong>Treasury Agent</strong><span>Incident 0042 · Sep 9</span></div><StatusBadge status="CRITICAL" tone="block" /></div><h3>Unexpected settlement behavior</h3><p>Funds reached a destination that did not match the approved supplier record.</p><button type="button" onClick={onOpenScar}>Open source incident <ArrowRight /></button></div>
      <div className="memory-to-decision"><span><Fingerprint /></span><span className="memory-rule-line" /><span><ShieldX /></span><p><strong>Learned safeguard applied</strong>Transfers to this counterparty cannot execute automatically.</p></div>
      <div className="blocked-note"><ShieldX /><div><strong>Automatic execution prevented.</strong><span>This action did not reach Base.</span></div></div>
    </div>
  );
}

export function IncidentDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; onSave: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="incident-dialog" showCloseButton>
        <DialogHeader><span className="dialog-symbol"><FileWarning /></span><p className="eyebrow">Create organizational Scar</p><DialogTitle>What should every agent learn from this?</DialogTitle><DialogDescription>Record the unsafe outcome and the safeguard that must apply next time.</DialogDescription></DialogHeader>
        <div className="incident-context"><span className="base-mark">B</span><div><strong>1 USDC to Supplier Alpha</strong><span>Base · Confirmed 21:05 · 0x8A...92F</span></div><CheckCircle2 /></div>
        <div className="form-grid">
          <label><span>Incident title</span><Input className="scar-input" defaultValue="Unexpected settlement behavior" /></label>
          <label><span>Severity</span><select className="scar-select" defaultValue="critical"><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option></select></label>
          <label className="full-field"><span>What happened</span><Textarea className="scar-textarea" defaultValue="Funds reached a destination that did not match the approved supplier record." /></label>
          <label className="full-field safeguard-field"><span>Learned safeguard</span><Textarea aria-label="Learned safeguard" className="scar-textarea" defaultValue="Future transfers involving this counterparty must not execute automatically." /><small><ShieldCheck />Applies to Treasury and Procurement agents</small></label>
        </div>
        <DialogFooter className="dialog-actions"><Button className="scar-button quiet-button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button className="scar-button primary-button" onClick={onSave}><Database />Save to Sibyl Memory</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
