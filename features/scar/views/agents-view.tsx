import { ChevronRight, Users } from "lucide-react";

import { agents } from "../demo-data";
import { AgentFace } from "../components/agent-face";
import { PageHeading } from "../components/app-shell";

export function AgentsView({ empty = false, onOpenAction }: { empty?: boolean; onOpenAction: () => void }) {
  return (
    <div className="content-wrap">
      <PageHeading eyebrow="Agents" title="Protection follows every role." copy="Each agent keeps its permissions and inherits the Scars relevant to its work." />
      <div className="agent-list">{empty ? <div className="empty-scars"><span><Users /></span><h2>No agents connected.</h2><p>Connected agents will appear here with their roles and inherited safeguards.</p></div> : agents.map((agent) => { const Icon = agent.icon; return <button className="agent-ledger-row" type="button" key={agent.name} onClick={onOpenAction}><AgentFace icon={Icon} shade={agent.shade} /><span className="agent-main"><strong>{agent.name}</strong><small>{agent.role}</small></span><span className="agent-stat"><small>Status</small><strong><span className="active-pip" />{agent.status}</strong></span><span className="agent-stat"><small>Protected actions</small><strong>{agent.protected}</strong></span><span className="agent-stat"><small>Scars inherited</small><strong>{agent.inherited}</strong></span><ChevronRight /></button>; })}</div>
    </div>
  );
}
