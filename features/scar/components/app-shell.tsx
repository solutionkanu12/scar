import type { ReactNode, Ref } from "react";
import { Activity, Fingerprint, Menu, RefreshCw, ShieldCheck, Users, X } from "lucide-react";

import type { Workspace } from "../scar-api";
import type { View } from "../types";
import { ScarMark } from "./brand";

interface AppShellProps {
  children: ReactNode;
  contentRef: Ref<HTMLElement>;
  hasScar: boolean;
  mobileNav: boolean;
  onHome: () => void;
  onNavigate: (view: View) => void;
  onSignOut: () => void;
  onWorkspaceChange: (workspaceId: string) => void;
  onToggleMobileNav: () => void;
  view: View;
  workspace: Workspace;
  workspaces: Workspace[];
}

export function AppShell({ children, contentRef, hasScar, mobileNav, onHome, onNavigate, onSignOut, onWorkspaceChange, onToggleMobileNav, view, workspace, workspaces }: AppShellProps) {
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
        <label className="workspace-picker">
          <span>Workspace</span>
          <select aria-label="Active workspace" value={workspace.id} onChange={(event) => onWorkspaceChange(event.target.value)}>
            {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <div className="protection-note">
          <span className="protection-icon"><ShieldCheck /></span>
          <div><strong>System protected</strong><span>Sibyl Memory available</span></div>
        </div>
        <button className="reset-link" type="button" onClick={onSignOut}><RefreshCw />Sign out</button>
      </aside>

      <main className="main-shell" ref={contentRef} tabIndex={-1}>{children}</main>
    </div>
  );
}

export function PageHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <header className="page-heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></header>;
}
