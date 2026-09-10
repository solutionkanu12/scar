import { ChevronRight, Fingerprint, History } from "lucide-react";

import { PageHeading } from "../components/app-shell";
import { StatusBadge } from "../components/status-badge";

export function ScarsView({ hasScar, onOpenScar }: { hasScar: boolean; onOpenScar: () => void }) {
  return (
    <div className="content-wrap">
      <PageHeading eyebrow="Scars" title="Experience your agents do not lose." copy="Every Scar records what happened, why it mattered, and the safeguard future agents inherit." />
      <section className="scar-ledger" aria-label="Organizational Scars">
        {hasScar ? <button className="scar-ledger-row primary-scar-row" type="button" onClick={onOpenScar}><span className="scar-ledger-icon"><Fingerprint /></span><span><small>INCIDENT 0042</small><strong>Unexpected settlement behavior</strong><em>Supplier Alpha</em></span><StatusBadge status="CRITICAL" tone="block" /><span className="inherited-by"><small>Inherited by</small><strong>Treasury + Procurement</strong></span><time>Sep 9</time><ChevronRight /></button> : <div className="empty-scars"><span><Fingerprint /></span><h2>No organizational Scars yet.</h2><p>When an unsafe outcome is recorded, the lesson will appear here and protect future agents.</p></div>}
        <button className="scar-ledger-row" type="button" disabled aria-label="Incident 0039 unavailable in this demo"><span className="scar-ledger-icon muted"><History /></span><span><small>INCIDENT 0039</small><strong>Unverified API permission request</strong><em>Index API</em></span><StatusBadge status="MEDIUM" tone="review" /><span className="inherited-by"><small>Inherited by</small><strong>Research</strong></span><time>Sep 7</time><ChevronRight /></button>
      </section>
    </div>
  );
}
