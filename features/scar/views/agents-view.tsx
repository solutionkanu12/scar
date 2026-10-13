import { ChevronRight, CircleDollarSign, Plus, Users } from "lucide-react";

import type { Agent } from "../scar-api";
import { AgentFace } from "../components/agent-face";
import { PageHeading } from "../components/app-shell";

export function AgentsView({ agents, onOpenAgent, onProvisionCredential, onRegister }: {
  agents: Agent[];
  onOpenAgent: (agentId: string) => void;
  onProvisionCredential: () => void;
  onRegister: () => void;
}) {
  return (
    <div className="content-wrap">
      <PageHeading eyebrow="Agents" title="Protection follows every role." copy="Each agent keeps its permissions and inherits the Scars relevant to its work." />
      <div className="section-heading"><div><h2>Connected agents</h2><p>Agents are durable workspace records.</p></div><div className="section-actions"><button className="scar-button quiet-button" type="button" disabled={agents.length === 0} onClick={onProvisionCredential}>Provision credential</button><button className="scar-button primary-button" type="button" onClick={onRegister}><Plus />Register agent</button></div></div>
      <div className="agent-list">{agents.length === 0 ? <div className="empty-scars"><span><Users /></span><h2>No agents connected.</h2><p>Register an agent before proposing protected work.</p></div> : agents.map((agent) => <button className="agent-ledger-row" type="button" key={agent.id} onClick={() => onOpenAgent(agent.id)}><AgentFace icon={CircleDollarSign} shade="yellow" /><span className="agent-main"><strong>{agent.name}</strong><small>{agent.role}</small></span><span className="agent-stat"><small>Status</small><strong><span className="active-pip" />{agent.status}</strong></span><span className="agent-stat"><small>Permissions</small><strong>{agent.permissions.length}</strong></span><span className="agent-stat"><small>Record</small><strong>Persisted</strong></span><ChevronRight /></button>)}</div>
    </div>
  );
}
