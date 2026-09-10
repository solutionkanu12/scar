import type { ReactNode, Ref } from "react";
import { Activity, Fingerprint, Menu, RefreshCw, ShieldCheck, Users, X } from "lucide-react";

import type { FlowStep, View } from "../types";
import { ScarMark } from "./brand";

interface AppShellProps {
  children: ReactNode;
  contentRef: Ref<HTMLElement>;
  hasScar: boolean;
  mobileNav: boolean;
  onHome: () => void;
  onNavigate: (view: View) => void;
  onReset: () => void;
  onToggleMobileNav: () => void;
  step: FlowStep;
  view: View;
}

export function AppShell({ children, contentRef, hasScar, mobileNav, onHome, onNavigate, onReset, onToggleMobileNav, step, view }: AppShellProps) {
  return (
    <div className="scar-app">
      <header className="mobile-header">
        <button className="icon-control" type="button" aria-label={mobileNav ? "Close navigation" : "Open navigation"} aria-controls="primary-sidebar" aria-expanded={mobileNav} onClick={onToggleMobileNav}>
          {mobileNav ? <X /> : <Menu />}
        </button>
        <button className="brand brand-mobile" type="button" onClick={onHome}>
          <ScarMark small />
          <span>Scar</span>
        </button>
        <span className="system-dot"><span />Protected</span>
      </header>

      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`} id="primary-sidebar">
        <button className="brand" type="button" onClick={onHome}>
          <ScarMark />
          <span>Scar</span>
        </button>
        <p className="sidebar-label">Shared safety memory</p>
        <nav aria-label="Primary navigation">
          <button className={view === "activity" || view === "action" ? "nav-link active" : "nav-link"} type="button" onClick={() => onNavigate("activity")}><Activity />Activity</button>
          <button className={view === "agents" ? "nav-link active" : "nav-link"} type="button" onClick={() => onNavigate("agents")}><Users />Agents</button>
          <button className={view === "scars" || view === "scar-detail" ? "nav-link active" : "nav-link"} type="button" onClick={() => onNavigate("scars")}><Fingerprint />Scars{hasScar && <span className="nav-count">1</span>}</button>
        </nav>
        <div className="sidebar-spacer" />
        <div className="protection-note">
          <span className="protection-icon"><ShieldCheck /></span>
          <div><strong>System protected</strong><span>Sibyl Memory available</span></div>
        </div>
        {step !== "initial" && <button className="reset-link" type="button" onClick={onReset}><RefreshCw />Reset activity</button>}
      </aside>

      <main className="main-shell" ref={contentRef} tabIndex={-1}>{children}</main>
    </div>
  );
}

export function PageHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <header className="page-heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></header>;
}
