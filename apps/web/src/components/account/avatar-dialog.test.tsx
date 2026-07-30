import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { AvatarDialog } from "./avatar-dialog";

const getAvatar = vi.fn();
const removeAvatar = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: { user: { image: null } } }) }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getAvatar: (...a: unknown[]) => getAvatar(...a),
    removeAvatar: (...a: unknown[]) => removeAvatar(...a),
  };
});

const onClose = vi.fn();
function open(isOpen = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AvatarDialog open={isOpen} onClose={onClose} onAnnounce={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getAvatar.mockResolvedValue({ hash: null });
});

describe("AvatarDialog", () => {
  test("renders nothing when closed", () => {
    open(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("is a labelled modal dialog when open", async () => {
    open();
    const dialog = await screen.findByRole("dialog", { name: /your photo/i });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  // ⚠️ A position:fixed overlay under a transformed ancestor collapses into it. The dialog is
  // opened from inside the stage section, so it must escape to the body.
  test("portals to document.body rather than rendering in place", async () => {
    const { container } = open();
    await screen.findByRole("dialog");
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(document.body.querySelector("[role='dialog']")).not.toBeNull();
  });

  test("closes on Escape, on the backdrop, and on the close button", async () => {
    const { unmount } = open();
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("avatar-dialog-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(3);
    unmount();
  });

  // A real save, driven from this level: AvatarPanel's `onSaved` must be wired to `onClose`, not
  // just present. Removing the (loaded) avatar is the shortest committed mutation to drive.
  test("closes itself once a change is saved", async () => {
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    removeAvatar.mockResolvedValue({ ok: true });
    open();
    await waitFor(() => expect(screen.getByRole("button", { name: /remove photo/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    });
    await waitFor(() => expect(removeAvatar).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
