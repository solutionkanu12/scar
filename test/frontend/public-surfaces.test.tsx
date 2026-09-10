import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ScarApp } from "@/features/scar/scar-app";

describe("Scar public and legal surfaces", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("opens Privacy and returns home with addressable history", () => {
    render(<ScarApp />);

    fireEvent.click(screen.getByRole("button", { name: "Privacy Policy" }));
    expect(screen.getByRole("heading", { name: "Privacy Policy" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/privacy");

    fireEvent.click(screen.getByRole("button", { name: "Back to Scar" }));
    expect(screen.getByRole("heading", { name: "Agents should remember what hurt them." })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("opens Terms and responds to browser history changes", () => {
    render(<ScarApp />);

    fireEvent.click(screen.getByRole("button", { name: "Terms of Service" }));
    expect(screen.getByRole("heading", { name: "Terms of Service" })).toBeInTheDocument();

    act(() => {
      window.history.replaceState({}, "", "/privacy");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("heading", { name: "Privacy Policy" })).toBeInTheDocument();
  });

  it("opens the operator console from the public page", () => {
    render(<ScarApp />);

    fireEvent.click(screen.getAllByRole("button", { name: "Open Scar" })[0]);
    expect(screen.getByRole("heading", { name: "Every action carries what your agents learned." })).toBeInTheDocument();
  });

  it("keeps unavailable social and email destinations explicit and inert", () => {
    render(<ScarApp />);

    expect(screen.getByRole("button", { name: "GitHub link pending" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "X link pending" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Gmail link pending" })).toBeDisabled();
  });
});
