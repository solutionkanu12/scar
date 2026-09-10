import type { FlowEvent, FlowStep } from "./types";

const transitions: Record<FlowStep, Partial<Record<FlowEvent, FlowStep>>> = {
  loading: {},
  initial: { check: "checking-first" },
  "checking-first": { "memory-complete": "allowed" },
  allowed: { execute: "executing" },
  executing: { "execution-complete": "confirmed", "execution-failed": "execution-failed" },
  confirmed: { "save-scar": "scar-saved" },
  "scar-saved": { "start-fresh-session": "fresh" },
  fresh: { check: "checking-recall" },
  "checking-recall": { "memory-complete": "blocked" },
  blocked: {},
  review: { approve: "executing" },
  "execution-failed": { retry: "executing" },
  "sibyl-unavailable": {},
  "invalid-action": {},
  "unauthorized-agent": {},
};

export function transitionFlow(step: FlowStep, event: FlowEvent): FlowStep {
  const next = transitions[step][event];

  if (!next) {
    throw new Error(`Invalid Scar flow transition: ${step} -> ${event}`);
  }

  return next;
}
