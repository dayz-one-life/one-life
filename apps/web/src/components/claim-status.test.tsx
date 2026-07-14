import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClaimStatus } from "./claim-status";

const challenge = { sequence: ["Wave", "Salute"], progressIndex: 0, expiresAt: "2026-07-10T12:00:00.000Z", expired: false };

describe("ClaimStatus", () => {
  it("renders the emote sequence while pending", () => {
    render(<ClaimStatus status="pending" challenge={challenge} />);
    expect(screen.getByText("Wave")).toBeInTheDocument();
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
  });

  it("renders a success message when verified", () => {
    render(<ClaimStatus status="verified" challenge={null} />);
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
  });

  it("renders a cancelled message when cancelled", () => {
    render(<ClaimStatus status="cancelled" challenge={null} />);
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
  });
});
