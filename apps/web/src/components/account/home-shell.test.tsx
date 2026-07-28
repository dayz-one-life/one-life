import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { HomeShell } from "./home-shell";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
// The sidebar itself is not under test — and it drags in query hooks. Stub it.
vi.mock("./home-sidebar", () => ({ HomeSidebar: () => <aside data-testid="sidebar" /> }));

describe("HomeShell", () => {
  it("mounts the sidebar and grid for verified users", () => {
    mockStatus.mockReturnValue({ kind: "verified", link: { gamertag: "X" } });
    render(<HomeShell board={null}><p>main</p></HomeShell>);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
  });

  it.each(["loading", "signedOut", "unlinked", "pending"] as const)(
    "renders a single column with NO sidebar in the DOM for %s",
    (kind) => {
      mockStatus.mockReturnValue({ kind });
      render(<HomeShell board={null}><p>main</p></HomeShell>);
      expect(screen.getByText("main")).toBeInTheDocument();
      expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    },
  );
});
