"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

import { AppShell } from "./components/app-shell";
import { transitionFlow } from "./demo-flow";
import type { FlowEvent, FlowStep, View } from "./types";
import { ActionView, IncidentDialog } from "./views/action-view";
import { ActivityView } from "./views/activity-view";
import { AgentsView } from "./views/agents-view";
import { ScarDetailView } from "./views/scar-detail-view";
import { ScarsView } from "./views/scars-view";

export function ScarConsole({ initialStep = "initial", initialView = "activity", onHome }: { initialStep?: FlowStep; initialView?: View; onHome: () => void }) {
  const [view, setView] = useState<View>(initialView);
  const [step, setStep] = useState<FlowStep>(initialStep);
  const [mobileNav, setMobileNav] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (step === "checking-first") {
      const timer = window.setTimeout(() => setStep((current) => transitionFlow(current, "memory-complete")), 1150);
      return () => window.clearTimeout(timer);
    }
    if (step === "executing") {
      const timer = window.setTimeout(() => setStep((current) => transitionFlow(current, "execution-complete")), 1350);
      return () => window.clearTimeout(timer);
    }
    if (step === "checking-recall") {
      const timer = window.setTimeout(() => setStep((current) => transitionFlow(current, "memory-complete")), 1350);
      return () => window.clearTimeout(timer);
    }
  }, [step]);

  useEffect(() => {
    contentRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [view]);

  const hasScar = ["scar-saved", "fresh", "checking-recall", "blocked"].includes(step);

  function navigate(next: View) {
    setView(next);
    setMobileNav(false);
  }

  function copyValue(label: string, value: string) {
    if (navigator.clipboard) void navigator.clipboard.writeText(value).catch(() => undefined);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1200);
  }

  function restartFlow() {
    setStep("initial");
    navigate("activity");
  }

  function dispatchFlow(event: FlowEvent) {
    setStep((current) => transitionFlow(current, event));
  }

  function openActivityAction() {
    navigate("action");
    if (!["fresh", "checking-recall", "blocked"].includes(step)) setStep("initial");
  }

  return (
    <>
      <AppShell
        contentRef={contentRef}
        hasScar={hasScar}
        mobileNav={mobileNav}
        onHome={onHome}
        onNavigate={navigate}
        onReset={restartFlow}
        onToggleMobileNav={() => setMobileNav((current) => !current)}
        step={step}
        view={view}
      >
        {view === "activity" && <ActivityView step={step} hasScar={hasScar} onOpenAction={openActivityAction} onOpenScar={() => navigate("scar-detail")} />}
        {view === "action" && <ActionView step={step} onFlowEvent={dispatchFlow} onBack={() => navigate("activity")} onReport={() => setIncidentOpen(true)} onOpenScar={() => navigate("scar-detail")} onCopy={copyValue} copied={copied} />}
        {view === "agents" && <AgentsView onOpenAction={() => navigate("action")} />}
        {view === "scars" && <ScarsView hasScar={hasScar} onOpenScar={() => navigate("scar-detail")} />}
        {view === "scar-detail" && <ScarDetailView onBack={() => navigate("scars")} onOpenAction={() => navigate("action")} onCopy={copyValue} copied={copied} />}
      </AppShell>

      <IncidentDialog open={incidentOpen} onOpenChange={setIncidentOpen} onSave={() => { setIncidentOpen(false); dispatchFlow("save-scar"); navigate("action"); }} />
      <div className={`copy-toast ${copied ? "copy-toast-show" : ""}`} role="status" aria-live="polite"><Check />{copied ? `${copied} copied` : "Copied"}</div>
    </>
  );
}
