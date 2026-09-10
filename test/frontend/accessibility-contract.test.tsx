import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScarConsole } from "@/features/scar/scar-console";
import { IncidentDialog } from "@/features/scar/views/action-view";
import { ActivityView } from "@/features/scar/views/activity-view";
import { AgentsView } from "@/features/scar/views/agents-view";
import { LandingPage } from "@/features/scar/views/landing-page";
import { ScarsView } from "@/features/scar/views/scars-view";

describe("Scar accessibility contract", () => {
  it("exposes mobile navigation state and moves focus into the selected view", () => {
    render(<ScarConsole onHome={() => undefined} />);

    const menu = screen.getByRole("button", { name: "Open navigation" });
    expect(menu).toHaveAttribute("aria-controls", "primary-sidebar");
    expect(menu).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(menu);
    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(screen.getByRole("heading", { name: "Protection follows every role." })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("associates the public mobile menu with the links it controls", () => {
    render(<LandingPage onOpenConsole={() => undefined} onOpenLegal={() => undefined} />);

    const menu = screen.getByRole("button", { name: "Open navigation" });
    expect(menu).toHaveAttribute("aria-controls", "public-navigation-links");
    expect(document.getElementById("public-navigation-links")).toBeInTheDocument();
  });

  it("gives the incident form an accessible name, description, and labeled fields", () => {
    render(<IncidentDialog open onOpenChange={() => undefined} onSave={() => undefined} />);

    const dialog = screen.getByRole("dialog", { name: "What should every agent learn from this?" });
    expect(dialog).toHaveAccessibleDescription("Record the unsafe outcome and the safeguard that must apply next time.");
    expect(screen.getByRole("textbox", { name: "Incident title" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Severity" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "What happened" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Learned safeguard" })).toBeInTheDocument();
  });

  it("labels copy controls by the value they copy", () => {
    render(<ScarConsole onHome={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Treasury Agent action to Supplier Alpha" }));

    expect(screen.getByRole("button", { name: "Copy Supplier Alpha address" })).toBeInTheDocument();
  });

  it.each([
    ["loading", "Loading Scar", "Preparing protected activity."],
    ["review", "REVIEW", "Human approval required."],
    ["execution-failed", "Transaction failed", "Authorization remains ALLOW."],
    ["sibyl-unavailable", "Memory unavailable", "Protected execution remains paused."],
    ["invalid-action", "Invalid action", "This request cannot be evaluated."],
    ["unauthorized-agent", "Unauthorized agent", "This agent cannot propose protected actions."],
  ] as const)("renders the %s state with explicit non-color text", (initialStep, heading, explanation) => {
    render(<ScarConsole initialStep={initialStep} initialView="action" onHome={() => undefined} />);

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText(explanation)).toBeInTheDocument();
  });

  it("renders explicit empty activity and agent states", () => {
    const { rerender } = render(<ActivityView empty step="initial" hasScar={false} onOpenAction={() => undefined} onOpenScar={() => undefined} />);
    expect(screen.getByRole("heading", { name: "No protected activity yet." })).toBeInTheDocument();

    rerender(<AgentsView empty onOpenAction={() => undefined} />);
    expect(screen.getByRole("heading", { name: "No agents connected." })).toBeInTheDocument();
  });

  it("marks demo-only informational rows as unavailable instead of leaving dead controls", () => {
    const { rerender } = render(<ActivityView step="initial" hasScar={false} onOpenAction={() => undefined} onOpenScar={() => undefined} />);
    expect(screen.getByRole("button", { name: "Research Agent action to Index API" })).toBeDisabled();

    rerender(<ScarsView hasScar={false} onOpenScar={() => undefined} />);
    expect(screen.getByRole("button", { name: "Incident 0039 unavailable in this demo" })).toBeDisabled();
  });

  it("moves focus and scrolls to the top when drilling into the source incident", () => {
    render(<ScarConsole initialStep="blocked" initialView="action" onHome={() => undefined} />);
    vi.mocked(window.scrollTo).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Open source incident" }));

    expect(screen.getByRole("heading", { name: "Unexpected settlement behavior" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveFocus();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
  });
});
