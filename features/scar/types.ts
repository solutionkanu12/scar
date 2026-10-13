import type { LucideIcon } from "lucide-react";

export type View = "activity" | "agents" | "scars" | "action" | "scar-detail";
export type Surface = "landing" | "console" | "privacy" | "terms";
export type StatusTone = "allow" | "review" | "block" | "neutral" | "memory";

export interface AgentVisual {
  icon: LucideIcon;
  shade: "yellow" | "coral" | "olive";
}
