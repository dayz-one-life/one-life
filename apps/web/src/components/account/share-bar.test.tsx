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
  it("renders the link read-only and one target per platform", () => {
    render(<ShareBar link={LINK} />);
    expect(screen.getByLabelText("Your invite link")).toHaveValue(LINK);
    expect(screen.getByLabelText("Share on X")).toHaveAttribute(
      "href",
      expect.stringContaining(encodeURIComponent(LINK)),
    );
    expect(screen.getByLabelText("Share on Reddit")).toBeInTheDocument();
    expect(screen.getByLabelText("Share on WhatsApp")).toBeInTheDocument();
    expect(screen.getByLabelText("Share by email")).toBeInTheDocument();
  });

  it("makes Discord a COPY action, not a link — Discord has no web share intent", () => {
    render(<ShareBar link={LINK} />);
    const discord = screen.getByLabelText("Copy for Discord");
    expect(discord.tagName).toBe("BUTTON");
    expect(discord).not.toHaveAttribute("href");
  });

  it("announces the copy confirmation in a live region", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ShareBar link={LINK} />);
    await userEvent.click(screen.getByRole("button", { name: /copy link/i }));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(await screen.findByText(/link copied/i)).toBeInTheDocument();
  });

  it("omits the native-share button when navigator.share is absent", () => {
    // @ts-expect-error - deleting an optional platform capability
    delete navigator.share;
    render(<ShareBar link={LINK} />);
    expect(screen.queryByRole("button", { name: /more/i })).not.toBeInTheDocument();
  });
});
