import { describe, expect, it } from "vitest";

import { transitionFlow } from "@/features/scar/demo-flow";
import type { FlowEvent, FlowStep } from "@/features/scar/types";

describe("Scar demo flow", () => {
  it("advances through the complete allowed, incident, fresh-session, and blocked sequence", () => {
    const events: FlowEvent[] = [
      "check",
      "memory-complete",
      "execute",
      "execution-complete",
      "save-scar",
      "start-fresh-session",
      "check",
      "memory-complete",
    ];
    const expected: FlowStep[] = [
      "checking-first",
      "allowed",
      "executing",
      "confirmed",
      "scar-saved",
      "fresh",
      "checking-recall",
      "blocked",
    ];

    const visited = events.reduce<FlowStep[]>((steps, event) => {
      const next = transitionFlow(steps.at(-1) ?? "initial", event);
      return [...steps, next];
    }, []);

    expect(visited).toEqual(expected);
  });

  it.each([
    ["initial", "execute"],
    ["allowed", "save-scar"],
    ["blocked", "execute"],
    ["sibyl-unavailable", "execute"],
    ["invalid-action", "execute"],
    ["unauthorized-agent", "execute"],
  ] satisfies Array<[FlowStep, FlowEvent]>) (
    "rejects the %s -> %s transition",
    (step, event) => {
      expect(() => transitionFlow(step, event)).toThrow(
        `Invalid Scar flow transition: ${step} -> ${event}`,
      );
    },
  );

  it("keeps review approval and execution failure distinct from authorization", () => {
    expect(transitionFlow("review", "approve")).toBe("executing");
    expect(transitionFlow("executing", "execution-failed")).toBe("execution-failed");
    expect(transitionFlow("execution-failed", "retry")).toBe("executing");
  });
});
