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
  useSession.mockReturnValue({ data: null });
  useGamertagLinks.mockReturnValue({ data: [] });
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
    useSession.mockReturnValue({ data: { user: { id: "u1" } } });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "SomeoneElse", status: "verified" }] });
    render(<LocationPanel {...props} />);
    expect(screen.getByText("Positions withheld")).toBeInTheDocument();
  });

  it("shows the withheld bar to the owner while their link is only PENDING", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } } });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "Hero", status: "pending" }] });
    render(<LocationPanel {...props} />);
    expect(screen.getByText("Positions withheld")).toBeInTheDocument();
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("shows the map to the verified owner", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } } });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "Hero", status: "verified" }] });
    useLifeTrack.mockReturnValue({
      data: { mapCodename: "sakhal", segments: [], markers: [], sampleCount: 3, truncated: false, alive: true },
      isPending: false, isError: false,
    });
    render(<LocationPanel {...props} />);
    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(screen.queryByText("Positions withheld")).toBeNull();
  });

  it("distinguishes a resolved-empty track from a failed fetch", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } } });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "Hero", status: "verified" }] });
    useLifeTrack.mockReturnValue({
      data: { mapCodename: "sakhal", segments: [], markers: [], sampleCount: 0, truncated: false, alive: true },
      isPending: false, isError: false,
    });
    render(<LocationPanel {...props} />);
    expect(screen.getByText(/no fixes recorded/i)).toBeInTheDocument();
  });

  it("renders an explicit error line on a failed fetch, never an empty map", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } } });
    useGamertagLinks.mockReturnValue({ data: [{ gamertag: "Hero", status: "verified" }] });
    useLifeTrack.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<LocationPanel {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByText(/no fixes recorded/i)).toBeNull();
  });
});
