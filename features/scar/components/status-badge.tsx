import { Check, Clock3, History, ShieldCheck, X } from "lucide-react";

import type { StatusTone } from "../types";

export function StatusBadge({ status, tone }: { status: string; tone: StatusTone }) {
  const Icon = tone === "allow" ? Check : tone === "review" ? Clock3 : tone === "block" ? X : tone === "memory" ? History : ShieldCheck;
  return (
    <span className={`status-badge status-${tone}`}>
      <Icon aria-hidden="true" />
      {status}
    </span>
  );
}
