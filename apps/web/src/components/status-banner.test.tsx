import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { StatusBanner } from "./status-banner";
import type { GamertagLink } from "@/lib/types";

const NOW = 1_700_000_000_000;
const noop = { onCancel: vi.fn(), onReclaim: vi.fn() };

const pendingLink = (expired: boolean): GamertagLink => ({
  id: 7, serverId: 1, gamertag: "GHOST_ACTOR", status: "pending", verifiedAt: null,
  challenge: {
    sequence: ["Surrender", "Salute", "Point"], progressIndex: 1,
    expiresAt: new Date(NOW + 6 * 3_600_000).toISOString(), expired,
  },
});

describe("StatusBanner", () => {
  it("renders nothing when loading or verified", () => {
    const { container: a } = render(<StatusBanner status={{ kind: "loading" }} {...noop} />);
    expect(a).toBeEmptyDOMElement();
    const link = pendingLink(false);
    const { container: b } = render(<StatusBanner status={{ kind: "verified", link }} {...noop} />);
    expect(b).toBeEmptyDOMElement();
  });

  it("invites a signed-out visitor to sign in", () => {
    render(<StatusBanner status={{ kind: "signedOut" }} {...noop} />);
    expect(screen.getByText("Sign in to claim your gamertag")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
  });

  it("invites a linked-less user to link a gamertag", () => {
    render(<StatusBanner status={{ kind: "unlinked" }} {...noop} />);
    expect(screen.getByText("Link your gamertag to get started")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /link gamertag/i })).toHaveAttribute("href", "/account/claim");
  });

  it("shows emotes, live progress, expiry, and cancel while pending", () => {
    const onCancel = vi.fn();
    render(<StatusBanner status={{ kind: "pending", link: pendingLink(false) }} onCancel={onCancel} onReclaim={vi.fn()} now={NOW} />);
    expect(screen.getByText(/finish verifying/i)).toHaveTextContent("GHOST_ACTOR");
    expect(screen.getByText("1 / 3 DONE")).toBeInTheDocument();
    expect(screen.getByText("Salute")).toBeInTheDocument();
    expect(screen.getByText("expires in 6h")).toBeInTheDocument();
    screen.getByRole("button", { name: /cancel claim/i }).click();
    expect(onCancel).toHaveBeenCalled();
  });

  it("offers a fresh challenge when the pending challenge expired", () => {
    const onReclaim = vi.fn();
    render(<StatusBanner status={{ kind: "pending", link: pendingLink(true) }} onCancel={vi.fn()} onReclaim={onReclaim} now={NOW} />);
    expect(screen.getByText(/your verification for/i)).toHaveTextContent("GHOST_ACTOR");
    screen.getByRole("button", { name: /start a new challenge/i }).click();
    expect(onReclaim).toHaveBeenCalled();
  });
});
