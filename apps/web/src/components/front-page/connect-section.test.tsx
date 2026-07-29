import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ConnectSection } from "./connect-section";

describe("ConnectSection", () => {
  it("renders the light connect panel with the search term and maps", () => {
    render(<ConnectSection servers={{ kind: "ready", names: ["Chernarus", "Sakhal"] }} />);
    expect(screen.getByText("One Life")).toBeInTheDocument();
    expect(screen.getByText(/Chernarus, Sakhal/)).toBeInTheDocument();
    expect(screen.getByText(/Play first, claim later/i)).toBeInTheDocument();
  });

  it("exposes exactly one labelled landmark (HowToConnect's own)", () => {
    render(<ConnectSection servers={{ kind: "ready", names: ["Chernarus"] }} />);
    expect(screen.getAllByRole("region", { name: "How to connect" })).toHaveLength(1);
  });
});
