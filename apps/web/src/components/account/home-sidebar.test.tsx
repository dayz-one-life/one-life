import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { HomeSidebar } from "./home-sidebar";
import type { SidebarBoard } from "./home-sidebar";

const mockStatus = vi.fn();
vi.mock("@/lib/use-account-status", () => ({ useAccountStatus: () => mockStatus() }));
const mockNotifications = vi.fn();
vi.mock("@/lib/use-notifications", () => ({ useNotifications: () => mockNotifications() }));
vi.mock("@/components/friends/online-friends", () => ({ OnlineFriendsContainer: () => <div /> }));

beforeEach(() => {
  mockStatus.mockReturnValue({ kind: "signedOut" });
  mockNotifications.mockReturnValue({ firstPage: [], loading: false, error: false });
});

const board: SidebarBoard = {
  slug: "chernarus",
  map: "chernarusplus",
  failed: false,
  rows: [
    {
      gamertag: "Boots",
      slug: "chernarus",
      map: "chernarusplus",
      timeAliveSeconds: 96_720,
      killsThisLife: 0,
      longestKillMeters: null,
      avatarHash: null,
    },
  ],
};

describe("HomeSidebar board block", () => {
  // Rule (#9): a formatDuration value inside an uppercase row must stay normal-case, or a
  // 12/24-hour clock label ("26h") renders visually as if it were "26H", indistinguishable from
  // the surrounding shout-case copy.
  test("duration values are exempt from the row's uppercase", () => {
    render(<HomeSidebar board={board} />);
    const value = screen.getByText("26h 52m");
    expect(value.className).toContain("normal-case");
  });
});
