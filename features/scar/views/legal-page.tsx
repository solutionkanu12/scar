import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

import { ScarMark } from "../components/brand";
import { SiteFooter } from "./landing-page";

type LegalSurface = "privacy" | "terms";

export function LegalPage({ type, onHome, onOpenConsole, onOpenLegal }: { type: LegalSurface; onHome: () => void; onOpenConsole: () => void; onOpenLegal: (surface: LegalSurface) => void }) {
  const privacy = type === "privacy";
  return (
    <div className="legal-page">
      <header className="landing-nav-shell">
        <nav className="landing-nav" aria-label="Legal page navigation"><button className="brand" type="button" onClick={onHome}><ScarMark /><span>Scar</span></button><Button className="scar-button primary-button" onClick={onOpenConsole}>Open console<ArrowRight /></Button></nav>
      </header>
      <main className="legal-wrap">
        <button className="back-link" type="button" onClick={onHome}><ArrowLeft />Back to Scar</button>
        <p className="eyebrow">Legal</p>
        <h1>{privacy ? "Privacy Policy" : "Terms of Service"}</h1>
        <p className="legal-date">Last updated September 9, 2026</p>
        {privacy ? <PrivacyCopy /> : <TermsCopy />}
      </main>
      <SiteFooter onHome={onHome} onOpenLegal={onOpenLegal} />
    </div>
  );
}

function PrivacyCopy() {
  return (
    <article className="legal-copy">
      <section><h2>What Scar processes</h2><p>Scar may process workspace identifiers, agent names and roles, proposed actions, policy results, incident records, evidence references, timestamps, and technical logs needed to operate and secure the service.</p></section>
      <section><h2>How information is used</h2><p>Information is used to check protected actions, retrieve relevant organizational memory, explain decisions, investigate incidents, improve reliability, and prevent unauthorized use.</p></section>
      <section><h2>Sibyl Memory and public networks</h2><p>Incident memories may be stored through Sibyl according to your workspace configuration. Transaction hashes and other evidence written to a public blockchain can remain publicly visible. Do not place secrets, personal data, or confidential business information in public transaction data.</p></section>
      <section><h2>Data sharing</h2><p>Scar shares information only with service providers and infrastructure required to deliver configured product functions, comply with law, or protect the service. Scar does not sell personal information.</p></section>
      <section><h2>Retention and security</h2><p>Records are retained for as long as needed to provide the service, meet configured retention requirements, resolve disputes, and maintain security. No system is completely secure, but Scar is designed to minimize access and preserve traceability.</p></section>
      <section><h2>Your choices</h2><p>Workspace administrators may request access, correction, export, or deletion of eligible information, subject to legal, security, public blockchain, and technical limitations.</p></section>
      <section><h2>Contact</h2><p>Use the email channel linked in the Scar footer for privacy questions. A dedicated company address will be published before production use.</p></section>
    </article>
  );
}

function TermsCopy() {
  return (
    <article className="legal-copy">
      <section><h2>Using Scar</h2><p>You may use Scar only for systems and agent actions you are authorized to operate. You are responsible for your workspace, agent permissions, policy configuration, connected wallets, and transaction approvals.</p></section>
      <section><h2>Authorization decisions</h2><p>Scar provides safety controls and supporting evidence. It does not replace human judgment, security review, financial controls, or legal obligations. You must verify that policies match your risk requirements before relying on them.</p></section>
      <section><h2>Blockchain actions</h2><p>Blockchain transactions can be irreversible and may involve network fees, contract risk, or third-party services. Scar separates authorization from execution, but you remain responsible for actions sent through your configured accounts.</p></section>
      <section><h2>Acceptable use</h2><p>Do not use Scar to access systems without permission, evade controls, distribute malicious code, harm others, or violate applicable law. Do not attempt to interfere with the service or another workspace.</p></section>
      <section><h2>Availability</h2><p>The service may change, pause, or become unavailable. Protected actions should remain stopped when required memory or policy services cannot be verified. You are responsible for maintaining appropriate operational fallbacks.</p></section>
      <section><h2>Intellectual property</h2><p>Scar and its product materials remain the property of their respective owners. You retain rights to the content and records you provide, subject to the permissions needed to operate the service.</p></section>
      <section><h2>Changes and contact</h2><p>These terms may be updated as Scar develops. Material changes will be reflected by the date above. Use the email channel in the footer for questions before production use.</p></section>
    </article>
  );
}
