"use client";

import { useState } from "react";
import Image from "next/image";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  Fingerprint,
  Menu,
  PackageCheck,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import { AgentFace } from "../components/agent-face";
import { GmailMark, GithubMark, ScarMark } from "../components/brand";
import { StatusBadge } from "../components/status-badge";

type LegalSurface = "privacy" | "terms";

export function LandingPage({ onOpenConsole, onOpenLegal }: { onOpenConsole: () => void; onOpenLegal: (surface: LegalSurface) => void }) {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <div className="landing-page">
      <header className="landing-nav-shell">
        <nav className="landing-nav" aria-label="Public navigation">
          <a className="brand" href="#top" aria-label="Scar home"><ScarMark /><span>Scar</span></a>
          <div className={`landing-links ${navOpen ? "landing-links-open" : ""}`} id="public-navigation-links">
            <a href="#mechanism" onClick={() => setNavOpen(false)}>How it works</a>
            <a href="#proof" onClick={() => setNavOpen(false)}>Memory in action</a>
            <a href="#safety" onClick={() => setNavOpen(false)}>Safety</a>
          </div>
          <div className="landing-nav-actions">
            <Button className="scar-button primary-button" onClick={onOpenConsole}>Open console<ArrowRight /></Button>
            <button className="landing-menu" type="button" aria-label={navOpen ? "Close navigation" : "Open navigation"} aria-controls="public-navigation-links" aria-expanded={navOpen} onClick={() => setNavOpen((current) => !current)}>{navOpen ? <X /> : <Menu />}</button>
          </div>
        </nav>
      </header>

      <main id="top">
        <section className="landing-hero">
          <div className="hero-copy">
            <p className="eyebrow">Shared safety memory for autonomous agents</p>
            <h1>Agents should remember what hurt them.</h1>
            <p>Scar turns past incidents into evidence before the next high-impact action. One agent gets burned. Every agent learns.</p>
            <div className="hero-actions">
              <Button className="scar-button primary-button" onClick={onOpenConsole}>Open Scar<ArrowRight /></Button>
              <a href="#mechanism">See how memory changes a decision</a>
            </div>
            <ul className="trust-line" aria-label="Core system boundaries">
              <li><Database />Sibyl Memory for recall</li>
              <li><ClipboardCheck />Deterministic policy</li>
              <li><ShieldCheck />Execution stays gated</li>
            </ul>
          </div>

          <div className="hero-product" aria-label="Scar blocks an action using a previous incident">
            <div className="hero-product-top"><span><ScarMark small />Live decision</span><StatusBadge status="BLOCK" tone="block" /></div>
            <div className="hero-action-row">
              <AgentFace icon={PackageCheck} shade="coral" />
              <span><small>Procurement Agent</small><strong>Send 4 USDC to Supplier Alpha</strong></span>
              <span className="hero-action-id">ACT-219</span>
            </div>
            <div className="hero-memory-link">
              <span className="memory-pin"><Fingerprint /></span>
              <span className="hero-rule" />
              <span className="block-pin"><ShieldX /></span>
            </div>
            <div className="hero-incident">
              <p className="eyebrow">Related memory found</p>
              <div><AgentFace icon={CircleDollarSign} shade="yellow" /><span><strong>Unexpected settlement behavior</strong><small>Treasury Agent · Critical · Incident 0042</small></span></div>
              <p>Future transfers involving this counterparty must not execute automatically.</p>
            </div>
            <div className="hero-product-result"><ShieldX /><span><small>Authorization</small><strong>Automatic execution prevented.</strong></span></div>
          </div>
        </section>

        <section className="landing-section mechanism-section" id="mechanism">
          <div className="section-intro">
            <p className="eyebrow">The mechanism</p>
            <h2>One incident becomes a safer fleet.</h2>
            <p>Scar does not store memories for display. It makes the right memory available when another agent is about to take a related action.</p>
          </div>
          <div className="mechanism-layout">
            <figure className="memory-photo">
              <Image src="/scar-archive.jpg" alt="An open archival card drawer with carefully organized records" width={1400} height={933} sizes="(max-width: 960px) calc(100vw - 32px), 50vw" />
              <figcaption><Fingerprint />Organizational memory should be retrievable, attributable, and useful.</figcaption>
            </figure>
            <ol className="mechanism-ledger">
              <li><span>01</span><div><strong>An agent acts</strong><p>A consequential request passes memory and policy checks before execution.</p></div></li>
              <li><span>02</span><div><strong>An unsafe outcome is recorded</strong><p>The operator captures what happened, the evidence, and the safeguard.</p></div></li>
              <li><span>03</span><div><strong>Sibyl persists the lesson</strong><p>The incident becomes shared organizational memory with clear provenance.</p></div></li>
              <li><span>04</span><div><strong>The next decision changes</strong><p>A fresh agent retrieves the Scar. Deterministic policy returns REVIEW or BLOCK.</p></div></li>
            </ol>
          </div>
        </section>

        <section className="landing-section proof-section" id="proof">
          <div className="proof-heading">
            <div><p className="eyebrow">Memory in action</p><h2>The second agent starts fresh. The lesson does not.</h2></div>
            <p>Scar keeps the cause and the changed decision in one readable path.</p>
          </div>
          <div className="session-story">
            <article className="session-panel session-one">
              <div className="session-label"><span>Session 1</span><StatusBadge status="ALLOW" tone="allow" /></div>
              <div className="session-agent"><AgentFace icon={CircleDollarSign} shade="yellow" /><span><strong>Treasury Agent</strong><small>1 USDC to Supplier Alpha</small></span></div>
              <div className="session-memory"><BookOpen /><span><strong>No related incidents</strong><small>Memory checked before execution</small></span></div>
              <div className="session-outcome"><TriangleAlert /><span><strong>Unsafe outcome recorded</strong><small>Incident 0042 saved to Sibyl</small></span></div>
            </article>
            <div className="session-bridge"><span><Fingerprint /></span><p>Scar 0042</p><ArrowRight /></div>
            <article className="session-panel session-two">
              <div className="session-label"><span>Fresh session</span><StatusBadge status="BLOCK" tone="block" /></div>
              <div className="session-agent"><AgentFace icon={PackageCheck} shade="coral" /><span><strong>Procurement Agent</strong><small>4 USDC to Supplier Alpha</small></span></div>
              <div className="session-memory remembered"><Fingerprint /><span><strong>Treasury incident recalled</strong><small>Critical memory with source evidence</small></span></div>
              <div className="session-outcome blocked"><ShieldX /><span><strong>Execution prevented</strong><small>The action never reached Base</small></span></div>
            </article>
          </div>
          <Button className="scar-button dark-button proof-cta" onClick={onOpenConsole}>Walk through the decision<ArrowRight /></Button>
        </section>

        <section className="landing-section safety-section" id="safety">
          <div className="safety-statement">
            <p className="eyebrow">Safety boundary</p>
            <h2>Memory explains. Policy decides.</h2>
            <p>The LLM can interpret context and write a clear explanation. It cannot authorize a high-impact action.</p>
          </div>
          <div className="safety-rules">
            <div><span><Database /></span><div><strong>Memory is evidence</strong><p>Sibyl stores and retrieves organizational incidents. Memory never executes an action.</p></div></div>
            <div><span><ClipboardCheck /></span><div><strong>Authorization is deterministic</strong><p>Bounded policy code returns ALLOW, REVIEW, or BLOCK.</p></div></div>
            <div><span><ShieldX /></span><div><strong>Unknown means stop</strong><p>If Scar cannot verify organizational memory, protected execution stays paused.</p></div></div>
            <div><span><CheckCircle2 /></span><div><strong>Every decision is traceable</strong><p>The operator can open the exact incident and evidence that changed an action.</p></div></div>
          </div>
        </section>

        <section className="landing-close">
          <span className="closing-mark"><ScarMark /></span>
          <p className="eyebrow">One agent gets burned. Every agent learns.</p>
          <h2>Give the next agent the lesson before the consequence.</h2>
          <Button className="scar-button primary-button" onClick={onOpenConsole}>Open Scar<ArrowRight /></Button>
        </section>
      </main>

      <SiteFooter onHome={() => window.scrollTo({ top: 0, behavior: "smooth" })} onOpenLegal={onOpenLegal} />
    </div>
  );
}

export function SiteFooter({ onHome, onOpenLegal }: { onHome: () => void; onOpenLegal: (surface: LegalSurface) => void }) {
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <button className="brand" type="button" onClick={onHome}><ScarMark /><span>Scar</span></button>
        <p>Shared safety memory for autonomous agents.</p>
        <div className="footer-social" aria-label="Social links">
          <button type="button" aria-label="GitHub link pending" title="Project GitHub link to be added" disabled><GithubMark /></button>
          <button type="button" aria-label="X link pending" title="Project X link to be added" disabled><span aria-hidden="true">X</span></button>
          <button type="button" aria-label="Gmail link pending" title="Project Gmail address to be added" disabled><GmailMark /></button>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 Scar</span>
        <div><button type="button" onClick={() => onOpenLegal("privacy")}>Privacy Policy</button><button type="button" onClick={() => onOpenLegal("terms")}>Terms of Service</button></div>
      </div>
    </footer>
  );
}
