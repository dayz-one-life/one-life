import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import SiteLayout from "./layout";

vi.mock("@/components/header", () => ({ Masthead: () => <div data-testid="masthead" /> }));
vi.mock("@/components/footer", () => ({ Footer: () => <div data-testid="footer" /> }));

describe("SiteLayout", () => {
  test("supplies exactly one #main-content for the skip link", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    expect(document.querySelectorAll("#main-content")).toHaveLength(1);
  });

  test("renders the masthead and footer that /maps deliberately opts out of", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    expect(screen.getByTestId("masthead")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
  });

  // ⚠️ The fixed bottom tab bar is DELETED — shell/nav-menu.tsx in the masthead is the nav at
  // every width now. Reintroducing a bar here also reintroduces the two gutters (the footer's
  // and the map friends sheet's) that had to reserve space for it.
  test("renders no bottom bar", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    expect(screen.queryByRole("navigation", { name: /quick access/i })).toBeNull();
  });

  // The bottom gutter belongs on the FOOTER, not here. The footer is a sibling after this
  // column and so is the last in-flow element in the document; padding the column leaves the
  // footer under the phone's home indicator. See footer.test.tsx for the gutter's own test.
  test("does NOT carry a bottom gutter — that belongs to the footer", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    expect(document.getElementById("main-content")!.className).not.toMatch(/\bpb-/);
  });

  // The content box lives in (boxed)/layout.tsx so /maps/[map] — the one page outside that
  // group — can run terrain edge to edge on a wide desktop. A max-w restored here would quietly
  // re-box the map.
  test("does NOT constrain width — the content box belongs to (boxed)", () => {
    render(<SiteLayout><div data-testid="child" /></SiteLayout>);
    expect(document.getElementById("main-content")!.className).not.toMatch(/max-w/);
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
