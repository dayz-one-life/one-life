import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useState } from "react";
import { useModalBehavior } from "./use-modal-behavior";

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const [, setBump] = useState(0);
  const close = () => { setOpen(false); onClose?.(); };
  const ref = useModalBehavior(open, close);
  return (
    <div>
      <button onClick={() => setOpen(true)}>open</button>
      {open && (
        <div role="dialog" aria-modal="true" ref={ref} tabIndex={-1}>
          <button>first</button>
          <button onClick={() => setBump((b) => b + 1)}>bump</button>
          <button>last</button>
        </div>
      )}
    </div>
  );
}

describe("useModalBehavior", () => {
  test("locks body scroll while open and unlocks on close", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open"));
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.style.overflow).toBe("");
  });

  test("Escape closes and focus returns to the opener", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByText("open");
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(opener).toHaveFocus();
  });

  test("Tab wraps from last to first inside the panel", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open"));
    const last = screen.getByText("last");
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByText("first")).toHaveFocus();
  });

  test("parent re-renders while open do not yank focus back to the panel", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open"));
    const last = screen.getByText("last");
    last.focus();
    fireEvent.click(screen.getByText("bump")); // re-render → new inline onClose identity
    expect(last).toHaveFocus();
  });
});
