import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("Scar public surface", () => {
  it("exposes the brand, primary opening action, and legal affordances", () => {
    render(<Home />);

    expect(screen.getByRole("link", { name: "Scar home" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /open scar/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Privacy Policy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Terms of Service" })).toBeInTheDocument();
  });
});
