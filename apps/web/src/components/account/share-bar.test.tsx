import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShareBar } from "./share-bar";

const LINK = "https://dayzonelife.com/i/manicdote";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<ShareBar />", () => {
  it("renders no social share targets", () => {
    render(<ShareBar link={LINK} />);
    expect(screen.queryByLabelText(/share on/i)).toBeNull();
    expect(screen.queryByLabelText(/discord/i)).toBeNull();
    expect(screen.queryByText("More…")).toBeNull();
  });

  it("announces the copy confirmation in a live region", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ShareBar link={LINK} />);
    await userEvent.click(screen.getByRole("button", { name: /copy link/i }));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(await screen.findByText(/link copied/i)).toBeInTheDocument();
  });
});
