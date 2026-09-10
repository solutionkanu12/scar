import { ArrowLeft, ArrowRight, Check, CircleDollarSign, Copy, Fingerprint, PackageCheck, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

import { AgentFace } from "../components/agent-face";
import { StatusBadge } from "../components/status-badge";

export function ScarDetailView({ onBack, onOpenAction, onCopy, copied }: { onBack: () => void; onOpenAction: () => void; onCopy: (label: string, value: string) => void; copied: string | null }) {
  return (
    <div className="content-wrap scar-detail-page">
      <button className="back-link" type="button" onClick={onBack}><ArrowLeft />Scars</button>
      <div className="scar-detail-title"><span className="large-scar-mark"><Fingerprint /></span><div><p className="eyebrow">Incident 0042</p><h1>Unexpected settlement behavior</h1><p>Supplier Alpha · Sep 9, 2026 at 21:05</p></div><StatusBadge status="CRITICAL" tone="block" /></div>
      <div className="scar-detail-grid">
        <section className="incident-story"><div><p className="eyebrow">What happened</p><h2>A payment settled somewhere it should not.</h2><p>Treasury Agent executed a payment after the supplier settlement destination changed. Funds reached a destination that did not match the approved supplier record.</p></div><div><p className="eyebrow">Outcome</p><p>The transfer completed, but the destination could not be verified against the known counterparty record.</p></div><div className="safeguard-callout"><ShieldCheck /><div><p className="eyebrow">Learned safeguard</p><h2>Do not execute related transfers automatically.</h2><p>Future transfers involving Supplier Alpha require the action gate to return BLOCK.</p></div></div></section>
        <aside className="incident-evidence"><h2>Evidence</h2><dl><div><dt>Agent</dt><dd>Treasury Agent</dd></div><div><dt>Action</dt><dd>Send 1 USDC</dd></div><div><dt>Network</dt><dd><span className="base-dot">B</span>Base</dd></div><div><dt>Transaction</dt><dd><button className="hash-copy" aria-label="Copy Base transaction hash" type="button" onClick={() => onCopy("Transaction hash", "0x8A...92F")}>0x8A...92F {copied === "Transaction hash" ? <Check /> : <Copy />}</button></dd></div><div><dt>Sibyl memory</dt><dd><button className="hash-copy" aria-label="Copy Sibyl memory ID" type="button" onClick={() => onCopy("Memory ID", "mem_7f21...4d")}>mem_7f21...4d {copied === "Memory ID" ? <Check /> : <Copy />}</button></dd></div></dl><div className="affected-agents"><p className="eyebrow">Inherited by</p><span><AgentFace icon={CircleDollarSign} shade="yellow" />Treasury</span><span><AgentFace icon={PackageCheck} shade="coral" />Procurement</span></div><Button className="scar-button dark-button" onClick={onOpenAction}>See decision using this Scar <ArrowRight /></Button></aside>
      </div>
    </div>
  );
}
