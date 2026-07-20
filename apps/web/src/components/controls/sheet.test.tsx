import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { ControlsSheet } from "./sheet";

const mockPathname = vi.fn(() => "/");
vi.mock("next/navigation", () => ({ usePathname: () => mockPathname() }));

function matchMediaStub(reduce: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

beforeEach(() => {
  vi.useRealTimers();
  mockPathname.mockReturnValue("/");
  matchMediaStub(false);
});

const sheet = (open: boolean, onClose = vi.fn()) => (
  <ControlsSheet open={open} onClose={onClose} header={<span>Boots</span>}>
    <p>Body</p>
  </ControlsSheet>
);

describe("ControlsSheet", () => {
  test("closed renders nothing; open renders the dialog with a drag zone", () => {
    const { rerender } = render(sheet(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(sheet(true));
    const dialog = screen.getByRole("dialog", { name: "Player controls" });
    expect(dialog.querySelector("[data-sheet-drag-zone]")).not.toBeNull();
  });

  test("two-phase close: DOM survives closing, unmounts after the exit", () => {
    vi.useFakeTimers();
    const { rerender } = render(sheet(true));
    rerender(sheet(false));
    // Still mounted during the exit phase…
    expect(screen.getByRole("dialog")).toHaveClass("translate-y-full");
    // …gone after the safety timeout.
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("reduced motion closes instantly", () => {
    matchMediaStub(true);
    const { rerender } = render(sheet(true));
    rerender(sheet(false));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("route change closes the sheet", () => {
    const onClose = vi.fn();
    const { rerender } = render(sheet(true, onClose));
    mockPathname.mockReturnValue("/players/boots");
    rerender(sheet(true, onClose));
    expect(onClose).toHaveBeenCalled();
  });

  test("scrim click and × still close", () => {
    const onClose = vi.fn();
    const { container } = render(sheet(true, onClose));
    fireEvent.click(container.querySelector(".bg-dark\\/55")!);
    fireEvent.click(screen.getByRole("button", { name: "Close controls" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test("safe-area padding and dvh cap are present", () => {
    render(sheet(true));
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-h-[85dvh]");
    expect(dialog.innerHTML).toContain("safe-area-inset-bottom");
  });

  test("reopening during the exit resurrects the sheet", () => {
    vi.useFakeTimers();
    const { rerender } = render(sheet(true));
    rerender(sheet(false)); // exit starts
    rerender(sheet(true)); // …user reopens mid-exit
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
