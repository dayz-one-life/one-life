import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocationPanel, isOwnerOf } from "./location-panel";

const useSession = vi.fn();
const useGamertagLinks = vi.fn();
const useLifeTrack = vi.fn();

vi.mock("@/lib/auth-client", () => ({ useSession: () => useSession() }));
vi.mock("@/lib/use-gamertag-links", () => ({ useGamertagLinks: () => useGamertagLinks() }));
vi.mock("@/lib/use-life-track", () => ({ useLifeTrack: () => useLifeTrack() }));
vi.mock("./track-map", () => ({ default: () => <div data-testid="map" /> }));

const props = { mapSlug: "sakhal", lifeNumber: 1, pageGamertag: "Hero", alive: true };

beforeEach(() => {
  useSession.mockReturnValue({ data: null, isPending: false });
  useGamertagLinks.mockReturnValue({ data: [], isPending: false });
  useLifeTrack.mockReturnValue({ data: null, isPending: false, isError: false });
});

// The repo convention (see unbanStateOf in self-unban-button.tsx) is to lift the state
// derivation out of the connected component so most assertions need no providers.
describe("isOwnerOf", () => {
  it("is false when signed out, whatever the links say", () => {
    expect(isOwnerOf(false, [{ gamertag: "Hero", status: "verified" }], "Hero")).toBe(false);
  });
  it("is false for a pending link", () => {
    expect(isOwnerOf(true, [{ gamertag: "Hero", status: "pending" }], "Hero")).toBe(false);
  });
  it("is false for a different gamertag", () => {
    expect(isOwnerOf(true, [{ gamertag: "Other", status: "verified" }], "Hero")).toBe(false);
  });
  it("matches case-insensitively", () => {
    expect(isOwnerOf(true, [{ gamertag: "hERo", status: "verified" }], "Hero")).toBe(true);
  });
  it("is false while links are still undefined", () => {
    expect(isOwnerOf(true, undefined, "Hero")).toBe(false);
  });
});

describe("LocationPanel", () => {
  it("shows the withheld bar to a signed-out visitor on an alive life", () => {
    render(<LocationPanel {...props} />);
    expect(screen.getByText("Positions withheld")).toBeInTheDocument();
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("shows the withheld bar to a signed-in NON-owner", () => {
    // isPending explicitly false: a signed-in visitor's gamertag-links query is ENABLED
    // (`useGamertagLinks(!!session?.user)`), so it always eventually settles isPending to
    // false. Leaving it undefined (falsy) used to make this test pass "by accident" while
    // describing a state an enabled query never actually occupies.
    useSession.mockReturnValue({ data: { user: { id: "u1" } }, isPending: false });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "SomeoneElse", status: "verified" }], isPending: false });
    render(<LocationPanel {...props} />);
    expect(screen.getByText("Positions withheld")).toBeInTheDocument();
  });

  it("shows a loading line, never the withheld bar, while gamertag links are still loading for a signed-in visitor", () => {
    // A stale-data race: `data` is undefined while useGamertagLinks is still fetching, so
    // isOwnerOf reads that as "not the owner" — without a dedicated loading gate this
    // renders the "positions withheld" bar for a few hundred ms before ownership is known,
    // which is loading rendered as permission-refused (the exact collapse this panel
    // forbids everywhere else). The copy is deliberately neutral (not "your fixes") because
    // at this point we don't yet know whether this visitor is the owner.
    useSession.mockReturnValue({ data: { user: { id: "u1" } }, isPending: false });
    useGamertagLinks.mockReturnValue({ data: undefined, isPending: true });
    render(<LocationPanel {...props} />);
    expect(screen.getByText(/checking the desk record/i)).toBeInTheDocument();
    expect(screen.queryByText("Positions withheld")).toBeNull();
  });

  it("shows a loading line, never the withheld bar, while the session itself is still resolving", () => {
    // useSession() is async: on first mount `data` is `null` and `isPending` is `true` —
    // before this fix that read as "signed out" and rendered the withheld bar for the
    // whole session-resolution window, which is loading rendered as permission-refused and
    // usually the LONGER half of the loading window for a real owner.
    useSession.mockReturnValue({ data: null, isPending: true });
    render(<LocationPanel {...props} />);
    expect(screen.getByText(/pulling your fixes/i)).toBeInTheDocument();
    expect(screen.queryByText("Positions withheld")).toBeNull();
  });

  it("keeps the instant withheld bar for a genuinely signed-out visitor (session resolved, no links fetch happens)", () => {
    useSession.mockReturnValue({ data: null, isPending: false });
    useGamertagLinks.mockReturnValue({ data: undefined, isPending: true });
    render(<LocationPanel {...props} />);
    expect(screen.getByText("Positions withheld")).toBeInTheDocument();
  });

  it("shows the withheld bar to the owner while their link is only PENDING", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } }, isPending: false });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "Hero", status: "pending" }] });
    render(<LocationPanel {...props} />);
    expect(screen.getByText("Positions withheld")).toBeInTheDocument();
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("shows the map to the verified owner", async () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } }, isPending: false });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "Hero", status: "verified" }] });
    useLifeTrack.mockReturnValue({
      data: { mapCodename: "sakhal", segments: [], markers: [], sampleCount: 3, truncated: false, alive: true },
      isPending: false, isError: false,
    });
    render(<LocationPanel {...props} />);
    // TrackMap is loaded via next/dynamic({ ssr: false }), which renders its fallback
    // (null) on the first synchronous pass and resolves the mocked module asynchronously
    // — findBy* flushes that microtask inside act(), unlike a synchronous getBy* assertion.
    expect(await screen.findByTestId("map")).toBeInTheDocument();
    expect(screen.queryByText("Positions withheld")).toBeNull();
  });

  it("shows a loading line while the fetch is pending, never the error or empty lines", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } }, isPending: false });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "Hero", status: "verified" }] });
    useLifeTrack.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<LocationPanel {...props} />);
    expect(screen.getByText(/pulling your fixes/i)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/no fixes recorded/i)).toBeNull();
  });

  it("distinguishes a resolved-empty track from a failed fetch", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } }, isPending: false });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "Hero", status: "verified" }] });
    useLifeTrack.mockReturnValue({
      data: { mapCodename: "sakhal", segments: [], markers: [], sampleCount: 0, truncated: false, alive: true },
      isPending: false, isError: false,
    });
    render(<LocationPanel {...props} />);
    expect(screen.getByText(/no fixes recorded/i)).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders an explicit error line on a failed fetch, never an empty map", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } }, isPending: false });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "Hero", status: "verified" }] });
    useLifeTrack.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<LocationPanel {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByText(/no fixes recorded/i)).toBeNull();
  });

  it("renders a distinct, honest line when the desk resolves to null — not a fault", () => {
    // useLifeTrack deliberately resolves a 403 to `null`: a SUCCESSFUL answer meaning
    // "the server says you are not the owner," not a fetch failure. This must never
    // render the "fault at the desk" line, which is specifically false in this case.
    useSession.mockReturnValue({ data: { user: { id: "u1" } }, isPending: false });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "Hero", status: "verified" }] });
    useLifeTrack.mockReturnValue({ data: null, isPending: false, isError: false });
    render(<LocationPanel {...props} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/will not release this record/i)).toBeInTheDocument();
    expect(screen.queryByText(/no fixes recorded/i)).toBeNull();
    expect(screen.queryByText(/couldn't load/i)).toBeNull();
  });
});
