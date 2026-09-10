import type { LucideIcon } from "lucide-react";

export type View = "activity" | "agents" | "scars" | "action" | "scar-detail";
export type Surface = "landing" | "console" | "privacy" | "terms";
export type FlowStep =
  | "loading"
  | "initial"
  | "checking-first"
  | "allowed"
  | "executing"
  | "confirmed"
  | "scar-saved"
  | "fresh"
  | "checking-recall"
  | "blocked"
  | "review"
  | "execution-failed"
  | "sibyl-unavailable"
  | "invalid-action"
  | "unauthorized-agent";
export type FlowEvent =
  | "check"
  | "memory-complete"
  | "execute"
  | "execution-complete"
  | "execution-failed"
  | "approve"
  | "retry"
  | "save-scar"
  | "start-fresh-session";
export type StatusTone = "allow" | "review" | "block" | "neutral" | "memory";

export interface DemoActivityRecord {
  id: string;
  agent: string;
  role: string;
  action: string;
  target: string;
  time: string;
  status: string;
  tone: StatusTone;
  icon: LucideIcon;
}

export interface DemoAgentRecord {
  name: string;
  role: string;
  status: string;
  protected: number;
  inherited: number;
  icon: LucideIcon;
  shade: "yellow" | "coral" | "olive";
}
