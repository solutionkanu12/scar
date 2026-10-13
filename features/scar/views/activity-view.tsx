import { BookOpen, Bot, ChevronRight, CircleDollarSign, Plus, ShieldCheck } from "lucide-react";

import type { ActionState, Agent } from "../scar-api";
import { AgentFace } from "../components/agent-face";
import { PageHeading } from "../components/app-shell";
import { StatusBadge } from "../components/status-badge";

export function ActivityView({ states, agents, onOpenAction, onPropose }: {
  states: ActionState[];
  agents: Agent[];
  onOpenAction: (actionId: string) => void;
  onPropose: () => void;
}) {
  return (
    <div className="content-wrap">
      <div className="heading-row">
        <PageHeading eyebrow="Activity" title="Every action carries what your agents learned." copy="Scar checks organizational memory before protected work can continue." />
        <div className="system-summary"><span className="system-dot"><span />Protected</span><p>{agents.length} active agents</p></div>
      </div>
      <section className="activity-section" aria-labelledby="recent-activity">
        <div className="section-heading"><div><h2 id="recent-activity">Recent activity</h2><p>Durable protected actions in this workspace</p></div><span className="live-label"><span />Live</span></div>
        <div className="activity-ledger">
          {states.length === 0 ? <div className="empty-scars"><span><BookOpen /></span><h2>No protected activity yet.</h2><p>Register an agent, then propose a protected action through SCAR.</p><button className="scar-button primary-button" type="button" onClick={onPropose} disabled={agents.length === 0}><Plus />Propose action</button>{agents.length === 0 && <small>Register an agent first.</small>}</div> : states.map((state) => {
            const agent = agents.find((item) => item.id === state.action.agentId);
            const decision = state.authorization?.decision ?? "READY";
            const tone = decision === "ALLOW" ? "allow" : decision === "REVIEW" ? "review" : decision === "BLOCK" ? "block" : "neutral";
            return <button key={state.action.id} className="activity-row" type="button" onClick={() => onOpenAction(state.action.id)} aria-label={`Open ${agent?.name ?? state.action.agentId} action to ${state.action.entityId}`}>
              <AgentFace icon={CircleDollarSign} shade="yellow" />
              <span className="activity-agent"><strong>{agent?.name ?? state.action.agentId}</strong><small>{agent?.role ?? "Registered agent"}</small></span>
              <span className="activity-action"><strong>Send {formatUsdc(state.action.amountAtomic)} USDC</strong><small>to {state.action.entityId}</small></span>
              <StatusBadge status={decision} tone={tone} />
              <time>{new Date(state.action.proposedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><ChevronRight className="row-chevron" />
            </button>;
          })}
        </div>
      </section>
      <section className="plain-proof" aria-label="How Scar protects actions"><span className="proof-step"><Bot />Agent asks</span><span className="proof-line" /><span className="proof-step proof-active"><BookOpen />Memory answers</span><span className="proof-line" /><span className="proof-step"><ShieldCheck />Policy decides</span></section>
    </div>
  );
}

function formatUsdc(amountAtomic: string): string {
  const amount = BigInt(amountAtomic);
  const unit = BigInt(1_000_000);
  const whole = amount / unit;
  const fraction = (amount % unit).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
