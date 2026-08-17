import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// DangerZone renders DeleteAccountDialog, which imports these. The dialog is closed here, so
// nothing is called — the mocks exist to keep this test off the real network modules.
vi.mock("@/lib/api", () => ({ getTokens: vi.fn(), deleteAccount: vi.fn() }));
vi.mock("@/lib/push", () => ({ signOutAndTeardownPush: vi.fn() }));

import { DangerZone } from "./danger-zone";

describe("DangerZone", () => {
  it("offers account deletion", () => {
    render(<DangerZone />);
    expect(screen.getByRole("button", { name: /delete account/i })).toBeInTheDocument();
  });

  it("says plainly that player history is kept", () => {
    render(<DangerZone />);
    expect(screen.getByText(/lives, deaths and obituaries stay/i)).toBeInTheDocument();
  });
});
