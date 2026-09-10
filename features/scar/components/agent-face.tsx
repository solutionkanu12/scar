import type { LucideIcon } from "lucide-react";

export function AgentFace({ icon: Icon, shade = "yellow" }: { icon: LucideIcon; shade?: string }) {
  return (
    <span className={`agent-face agent-${shade}`} aria-hidden="true">
      <Icon />
    </span>
  );
}
