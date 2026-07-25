import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import SiteLayout from "./layout";

vi.mock("@/components/header", () => ({ Masthead: () => <div data-testid="masthead" /> }));
vi.mock("@/components/footer", () => ({ Footer: () => <div data-testid="footer" /> }));
vi.mock("@/components/shell/tab-bar", () => ({
  TabBar: () => <nav aria-label="Quick access" data-testid="tab-bar" />,
}));

describe("SiteLayout", () => {
  test("supplies exactly one #main-content for the skip link", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    expect(document.querySelectorAll("#main-content")).toHaveLength(1);
  });

  test("renders the masthead, footer and tab bar that /maps deliberately opts out of", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    expect(screen.getByTestId("masthead")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
    expect(screen.getByTestId("tab-bar")).toBeInTheDocument();
  });

  // Pill re-homing (UX review sub-project 4) removed the old `pb-24` gutter because no
  // fixed-bottom chrome remained. The TabBar is fixed-bottom chrome again, so the gutter is back
  // — but sized to the bar, and only below `md` where the bar renders. Without it the bar covers
  // the last rows of every scrollable page.
  test("reserves bottom space for the tab bar below md, and drops it at md", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    const main = document.getElementById("main-content")!;
    expect(main.className).toMatch(/pb-\[calc\(4rem\+env\(safe-area-inset-bottom\)\)\]/);
    expect(main.className).toMatch(/md:pb-0/);
  });

  // The controls rail used to live here and therefore rendered on every page in the group, which
  // is what made Survivors, the dossier, Friends and Notifications 380px narrower than they
  // needed to be. The sidebar belongs to Home alone now.
  test("renders no sidebar and no two-column grid", () => {
    const { container } = render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    expect(container.querySelector("aside")).toBeNull();
    expect(document.getElementById("main-content")!.className).not.toMatch(/grid-cols/);
  });
});
