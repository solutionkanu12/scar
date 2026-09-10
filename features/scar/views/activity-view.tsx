import { BookOpen, Bot, CheckCircle2, ChevronRight, PackageCheck, RefreshCw, ShieldCheck } from "lucide-react";

import { activities } from "../demo-data";
import type { DemoActivityRecord, FlowStep } from "../types";
import { AgentFace } from "../components/agent-face";
import { PageHeading } from "../components/app-shell";
import { StatusBadge } from "../components/status-badge";

export function ActivityView({ empty = false, step, hasScar, onOpenAction, onOpenScar }: { empty?: boolean; step: FlowStep; hasScar: boolean; onOpenAction: () => void; onOpenScar: () => void }) {
  const fresh = ["fresh", "checking-recall", "blocked"].includes(step);
  const activityRows: DemoActivityRecord[] = fresh
    ? [{ id: "ACT-219", agent: "Procurement Agent", role: "Procurement", action: "Send 4 USDC", target: "Supplier Alpha", time: "Now", status: step === "blocked" ? "BLOCK" : "READY", tone: step === "blocked" ? "block" : "neutral", icon: PackageCheck }, ...activities]
    : activities;

  return (
    <div className="content-wrap">
      <div className="heading-row">
        <PageHeading eyebrow="Activity" title="Every action carries what your agents learned." copy="Scar checks organizational memory before protected work can continue." />
        <div className="system-summary"><span className="system-dot"><span />Protected</span><p>3 active agents</p></div>
      </div>
      {fresh && <button className="fresh-session-card" type="button" onClick={onOpenAction}><span className="fresh-icon"><RefreshCw /></span><span><strong>Fresh agent session</strong><small>No session state carried over. Organizational memory restored from Sibyl.</small></span><ChevronRight /></button>}
      {hasScar && !fresh && <button className="memory-saved-strip" type="button" onClick={onOpenScar}><span><CheckCircle2 />Incident 0042 is now shared safety memory</span><span>View Scar <ChevronRight /></span></button>}

      <section className="activity-section" aria-labelledby="recent-activity">
        <div className="section-heading"><div><h2 id="recent-activity">Recent activity</h2><p>Protected actions across your agent fleet</p></div><span className="live-label"><span />Live</span></div>
        <div className="activity-ledger">
          {empty ? <div className="empty-scars"><span><BookOpen /></span><h2>No protected activity yet.</h2><p>Protected actions will appear here when connected agents begin work.</p></div> : activityRows.map((item, index) => {
            const Icon = item.icon;
            return (
              <button key={`${item.id}-${index}`} className={`activity-row ${index !== 0 ? "inactive-row" : ""}`} type="button" onClick={index === 0 ? onOpenAction : undefined} disabled={index !== 0} aria-label={index === 0 ? `Open ${item.agent} action to ${item.target}` : `${item.agent} action to ${item.target}`}>
                <AgentFace icon={Icon} shade={item.agent.includes("Procurement") ? "coral" : item.agent.includes("Research") ? "olive" : "yellow"} />
                <span className="activity-agent"><strong>{item.agent}</strong><small>{item.role}</small></span>
                <span className="activity-action"><strong>{item.action}</strong><small>to {item.target}</small></span>
                <StatusBadge status={item.status} tone={item.tone} />
                <time>{item.time}</time>{index === 0 && <ChevronRight className="row-chevron" />}
              </button>
            );
          })}
        </div>
      </section>
      <section className="plain-proof" aria-label="How Scar protects actions"><span className="proof-step"><Bot />Agent asks</span><span className="proof-line" /><span className="proof-step proof-active"><BookOpen />Memory answers</span><span className="proof-line" /><span className="proof-step"><ShieldCheck />Policy decides</span></section>
    </div>
  );
}
