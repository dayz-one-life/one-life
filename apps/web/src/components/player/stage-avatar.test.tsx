import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { StageAvatar } from "./stage-avatar";

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

function mount(editable: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StageAvatar hash={null} fallbackInitial="M" editable={editable} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getAvatar.mockResolvedValue({ hash: null });
});

describe("StageAvatar", () => {
  test("shows no edit affordance at all to the public", () => {
    mount(false);
    expect(screen.queryByRole("button", { name: /update your photo/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("the pencil opens the dialog and nothing is rendered inline", async () => {
    mount(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /update your photo/i }));
    expect(await screen.findByRole("dialog", { name: /your photo/i })).toBeInTheDocument();
  });

  test("closing the dialog returns focus to the pencil", async () => {
    mount(true);
    const pencil = screen.getByRole("button", { name: /update your photo/i });
    // ⚠️ userEvent, not fireEvent, for this one click: jsdom's fireEvent.click does not run the
    // browser's default "focus the clicked element" action, so a plain fireEvent click never
    // puts focus ON the pencil in the first place — `useModalBehavior`'s restore would then be
    // restoring focus to `document.body`, and the assertion below would pass or fail for the
    // wrong reason regardless of whether focus-restore actually works. userEvent simulates that
    // default action, matching the elsewhere-established pattern (see friends-panel.test.tsx's
    // "moves focus into the sheet it opens").
    await userEvent.setup().click(pencil);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(pencil);
  });

  // Regression guard for the defect Task 3's review caught: the live region must be owned by
  // THIS component (always mounted, a sibling of the dialog), not by AvatarDialog/AvatarPanel —
  // otherwise a successful save closes (unmounts) the dialog in the same commit that would have
  // set the announcement text, and the announcement never reaches a screen reader.
  test("the success announcement survives the dialog closing", async () => {
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    removeAvatar.mockResolvedValue({ ok: true });
    mount(true);
    fireEvent.click(screen.getByRole("button", { name: /update your photo/i }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByRole("button", { name: /remove photo/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Avatar removed");
  });
});
