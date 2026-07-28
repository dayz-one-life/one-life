import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OwnerAvatar } from "./owner-avatar";

const mockSession = vi.fn();
const mockLinks = vi.fn();
vi.mock("@/lib/auth-client", () => ({ useSession: () => mockSession() }));
vi.mock("@/lib/use-gamertag-links", () => ({ useGamertagLinks: () => mockLinks() }));
vi.mock("@/components/account/avatar-panel", () => ({ AvatarPanel: () => <div data-testid="avatar-panel" /> }));

describe("OwnerAvatar", () => {
  it("owner (verified, matching): shows the toggle; panel appears on click", () => {
    mockSession.mockReturnValue({ data: { user: { id: "u1" } } });
    mockLinks.mockReturnValue({ data: [{ status: "verified", gamertag: "YrJustBad" }] });
    render(<OwnerAvatar pageGamertag="YrJustBad" />);
    expect(screen.queryByTestId("avatar-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Update photo/i }));
    expect(screen.getByTestId("avatar-panel")).toBeInTheDocument();
  });

  it("pending link: renders nothing", () => {
    mockSession.mockReturnValue({ data: { user: { id: "u1" } } });
    mockLinks.mockReturnValue({ data: [{ status: "pending", gamertag: "YrJustBad" }] });
    const { container } = render(<OwnerAvatar pageGamertag="YrJustBad" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stranger (different gamertag): renders nothing", () => {
    mockSession.mockReturnValue({ data: { user: { id: "u1" } } });
    mockLinks.mockReturnValue({ data: [{ status: "verified", gamertag: "SomeoneElse" }] });
    const { container } = render(<OwnerAvatar pageGamertag="YrJustBad" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("signed out: renders nothing and never fetches links", () => {
    mockSession.mockReturnValue({ data: null });
    mockLinks.mockReturnValue({ data: undefined });
    const { container } = render(<OwnerAvatar pageGamertag="YrJustBad" />);
    expect(container).toBeEmptyDOMElement();
  });
});
