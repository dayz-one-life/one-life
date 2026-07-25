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

  // ⚠️ The TabBar gutter belongs on the FOOTER, not here. The footer is a sibling after this
  // column and so is the last in-flow element in the document; padding the column leaves the
  // footer under the fixed bar. Verified in a browser: it hid the footer's About link, which is
  // the only route to About below `md`. See footer.test.tsx for the gutter's own test.
  test("does NOT carry the tab-bar gutter — that belongs to the footer", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    expect(document.getElementById("main-content")!.className).not.toMatch(/\bpb-/);
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
