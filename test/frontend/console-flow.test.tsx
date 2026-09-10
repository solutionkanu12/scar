import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScarConsole } from "@/features/scar/scar-console";

describe("Scar operator console", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("carries the Treasury incident into a fresh Procurement decision", () => {
    render(<ScarConsole onHome={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Treasury Agent action to Supplier Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Check this action" }));
    expect(screen.getByText("Looking for related incidents...")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1150));
    expect(screen.getByRole("heading", { name: "ALLOW" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Execute on Base" }));
    expect(screen.getByRole("heading", { name: "Sending on Base..." })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1350));
    expect(screen.getByRole("heading", { name: "Transaction confirmed" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Report unsafe outcome" }));
    expect(screen.getByRole("dialog", { name: "What should every agent learn from this?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save to Sibyl Memory" }));
    expect(screen.getByText("Scar 0042 now protects future agents.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start a fresh agent session" }));
    expect(screen.getByText("New runtime context. Organizational memory restored from Sibyl.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check this action" }));
    expect(screen.getByText("Looking for inherited risk...")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1350));
    expect(screen.getByRole("heading", { name: "BLOCK" })).toBeInTheDocument();
    expect(screen.getByText("This action did not reach Base.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open source incident" }));
    expect(screen.getByRole("heading", { name: "Unexpected settlement behavior" })).toBeInTheDocument();
  });
});
