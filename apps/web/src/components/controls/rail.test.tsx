import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { ControlsRail } from "./rail";
import { useControls, useControlsActions } from "./use-controls";

vi.mock("./use-controls", () => ({ useControls: vi.fn(), useControlsActions: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ signOut: vi.fn(async () => {}) }));

const mut = () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null });
const base = { name: "Boots", provider: "discord", balance: 3, servers: [], standing: [] };

beforeEach(() => {
  (useControlsActions as Mock).mockReturnValue({ claim: mut(), cancel: mut(), send: mut(), refer: mut(), redeem: mut() });
});

describe("ControlsRail", () => {
  test("signed out: CTA panel only", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "signedOut" } });
    render(<ControlsRail />);
    expect(screen.getByText("Get in the paper.")).toBeInTheDocument();
    expect(screen.queryByText("Unban tokens")).not.toBeInTheDocument();
  });

  test("unlinked: identity + link panel", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "unlinked" } });
    render(<ControlsRail />);
    expect(screen.getByText("Via discord · No gamertag")).toBeInTheDocument();
    expect(screen.getByText("Link your gamertag.")).toBeInTheDocument();
  });

  test("pending: prove-it panel", () => {
    (useControls as Mock).mockReturnValue({
      ...base,
      status: { kind: "pending", link: { id: 1, gamertag: "Boots", status: "pending", verifiedAt: null, challenge: { sequence: ["facepalm", "salute", "clap"], progressIndex: 0, expiresAt: "2027-01-01T00:00:00Z", expired: false } } },
    });
    render(<ControlsRail />);
    expect(screen.getByText("Prove it's you")).toBeInTheDocument();
  });

  test("verified: identity + tokens + servers header + footer links", () => {
    (useControls as Mock).mockReturnValue({
      ...base,
      status: { kind: "verified", link: { id: 1, gamertag: "BootsColdwater", status: "verified", verifiedAt: "2026-07-01T00:00:00Z", challenge: null } },
      servers: [{ id: 1, nitradoServiceId: 1, name: "s", map: "chernarusplus", slug: "chernarus", active: true, clockOffsetMs: 0, createdAt: "2026-01-01T00:00:00Z" }],
    });
    render(<ControlsRail />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("Unban tokens")).toBeInTheDocument();
    expect(screen.getByText("Your servers")).toBeInTheDocument();
    expect(screen.getByText("No life")).toBeInTheDocument(); // never-played server renders idle
    expect(screen.getByRole("link", { name: "Your profile →" })).toHaveAttribute("href", "/players/bootscoldwater");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  test("loading: skeleton, nothing interactive", () => {
    (useControls as Mock).mockReturnValue({ ...base, status: { kind: "loading" } });
    const { container } = render(<ControlsRail />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
