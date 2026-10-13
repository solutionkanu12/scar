import { ChevronRight, Fingerprint } from "lucide-react";

import type { Incident } from "../scar-api";
import { PageHeading } from "../components/app-shell";
import { StatusBadge } from "../components/status-badge";

export function ScarsView({ incidents, onOpenScar }: { incidents: Incident[]; onOpenScar: (incidentId: string) => void }) {
  return (
    <div className="content-wrap">
      <PageHeading eyebrow="Scars" title="Experience your agents do not lose." copy="Every Scar records what happened, why it mattered, and the safeguard future agents inherit." />
      <section className="scar-ledger" aria-label="Organizational Scars">
        {incidents.length === 0 ? <div className="empty-scars"><span><Fingerprint /></span><h2>No organizational Scars yet.</h2><p>When an unsafe outcome is recorded, the lesson will appear here and protect future agents.</p></div> : incidents.map((incident) => <button key={incident.id} className="scar-ledger-row primary-scar-row" type="button" onClick={() => onOpenScar(incident.id)}><span className="scar-ledger-icon"><Fingerprint /></span><span><small>{incident.id}</small><strong>{incident.reason}</strong><em>{incident.entityId}</em></span><StatusBadge status={incident.severity} tone={incident.severity === "LOW" ? "neutral" : incident.severity === "MEDIUM" ? "review" : "block"} /><span className="inherited-by"><small>Memory state</small><strong>Persisted locally</strong></span><time>{new Date(incident.createdAt).toLocaleDateString()}</time><ChevronRight /></button>)}
      </section>
    </div>
  );
}
