import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: vi.fn() }));
const mockPathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

import { useAccountStatus } from "@/lib/use-account-status";
import { TabBar } from "./tab-bar";

const status = (kind: string) => vi.mocked(useAccountStatus).mockReturnValue({ kind } as never);

describe("TabBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue("/");
  });

  test("signed in: five destinations", () => {
    status("verified");
    render(<TabBar />);
    for (const name of ["Home", "Map", "Board", "Friends", "You"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  test("signed in but unlinked still gets the full set — You is where sign-out lives", () => {
    status("unlinked");
    render(<TabBar />);
    expect(screen.getByRole("link", { name: "You" })).toBeInTheDocument();
  });

  test("signed out: four, with Sign in replacing Friends and You", () => {
    status("signedOut");
    render(<TabBar />);
    for (const name of ["Home", "Map", "Board", "Sign in"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("link", { name: "Friends" })).toBeNull();
    expect(screen.queryByRole("link", { name: "You" })).toBeNull();
  });

  test("renders nothing while identity is still resolving — never a flash of the wrong set", () => {
    status("loading");
    const { container } = render(<TabBar />);
    expect(container).toBeEmptyDOMElement();
  });

  test("marks the active destination", () => {
    status("verified");
    mockPathname.mockReturnValue("/survivors/livonia");
    render(<TabBar />);
    expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  // Home is an exact match for the same reason activeNavKey is: every path starts with "/".
  test("Home is active only on the root path", () => {
    status("verified");
    mockPathname.mockReturnValue("/friends");
    render(<TabBar />);
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Friends" })).toHaveAttribute("aria-current", "page");
  });

  // jsdom cannot observe paint order, so the altitude is pinned numerically the way
  // header.test.tsx pins the masthead's.
  test("sits on the z-40 chrome layer — above content, below the z-50 overlays", () => {
    status("verified");
    render(<TabBar />);
    const nav = screen.getByRole("navigation", { name: /quick access/i });
    const z = Number(/z-(\d+)/.exec(nav.className)?.[1]);
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(50);
  });

  // The safe-area inset must be inside the height calc. As padding under `border-box` it is
  // subtracted from the box and collapses the row on a notched phone in PWA mode.
  test("puts the safe-area inset in the height calc, not in padding alone", () => {
    status("verified");
    render(<TabBar />);
    const nav = screen.getByRole("navigation", { name: /quick access/i });
    expect(nav.className).toMatch(/h-\[calc\(4rem\+env\(safe-area-inset-bottom\)\)\]/);
  });

  // The icon is decoration over the label (mobile-shell mock): aria-hidden so the accessible
  // name stays the bare label, red-soft on the active tab (dark surface — never red-deep).
  test("stacks an aria-hidden icon over each label, red-soft when active", () => {
    status("verified");
    mockPathname.mockReturnValue("/friends");
    render(<TabBar />);
    const active = screen.getByRole("link", { name: "Friends" });
    const icon = active.querySelector("[aria-hidden]")!;
    expect(icon.textContent).not.toBe("");
    expect(icon.className).toMatch(/text-red-soft/);
    expect(active.className).toMatch(/text-paper/);
    const idle = screen.getByRole("link", { name: "Home" });
    expect(idle.querySelector("[aria-hidden]")!.className).not.toMatch(/text-red-soft/);
    expect(idle.className).toMatch(/text-cream-dim/);
  });

  test("every destination clears the 52px touch floor", () => {
    status("verified");
    render(<TabBar />);
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toMatch(/min-h-\[52px\]/);
    }
  });
});
