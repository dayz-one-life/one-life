import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { useState } from "react";
import { AvatarPanel } from "./avatar-panel";
import { SrStatus } from "@/components/shared/sr-status";
import { ApiError } from "@/lib/api";

const getAvatar = vi.fn();
const uploadAvatar = vi.fn();
const syncAvatar = vi.fn();
const removeAvatar = vi.fn();
const routerRefresh = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getAvatar: (...a: unknown[]) => getAvatar(...a),
    uploadAvatar: (...a: unknown[]) => uploadAvatar(...a),
    syncAvatar: (...a: unknown[]) => syncAvatar(...a),
    removeAvatar: (...a: unknown[]) => removeAvatar(...a),
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { image: "https://cdn.discordapp.com/avatars/1/a.png" } } }),
}));

const cropToBlob = vi.fn(async () => new Blob(["x"], { type: "image/webp" }));
const onSaved = vi.fn();

// `AvatarPanel` no longer owns the live region (it's handed `onAnnounce` and doesn't render
// `SrStatus` itself — see the ⚠️ in avatar-panel.tsx). This harness is a stand-in for the real
// owner, `StageAvatar`: it stays mounted across a `Save` that closes (unmounts) the panel, which
// is exactly the arrangement the announcement tests below depend on.
function Harness({ cropToBlob: crop }: { cropToBlob: typeof cropToBlob }) {
  const [open, setOpen] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  return (
    <>
      {open ? (
        <AvatarPanel
          onSaved={() => { onSaved(); setOpen(false); }}
          onAnnounce={setAnnouncement}
          cropToBlob={crop}
        />
      ) : (
        // Stand-in for reopening the real dialog — lets a test drive a SECOND save after the
        // first one closed the panel, to prove the (still-mounted) live region re-announces.
        <button type="button" onClick={() => setOpen(true)}>
          Reopen
        </button>
      )}
      <SrStatus>{announcement}</SrStatus>
    </>
  );
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness cropToBlob={cropToBlob} />
    </QueryClientProvider>,
  );
}
const panel = () => wrap();

function pickFile(name = "avatar.png") {
  const input = screen.getByLabelText(/choose an image/i) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], name, { type: "image/png" })] } });
}

// The cropper only produces a rect once its <img> reports natural dimensions.
function loadCropperImage(container: HTMLElement) {
  const img = container.querySelector("[data-testid='crop-stage'] img") as HTMLImageElement;
  Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: 400, configurable: true });
  fireEvent.load(img);
}

const save = () => screen.getByRole("button", { name: /^save$/i });

beforeEach(() => {
  vi.clearAllMocks();
  getAvatar.mockResolvedValue({ hash: null });
  cropToBlob.mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
  vi.stubGlobal("URL", { createObjectURL: () => "blob:fake", revokeObjectURL: vi.fn() });
});

describe("AvatarPanel", () => {
  test("Save is disabled until something is staged", async () => {
    panel();
    await waitFor(() => expect(save()).toBeDisabled());
  });

  test("shows the silhouette and no fabricated 'no avatar' claim while loading", () => {
    getAvatar.mockReturnValue(new Promise(() => {}));
    const { container } = panel();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('span[aria-hidden="true"] svg')).not.toBeNull();
  });

  test("renders the current avatar once resolved", async () => {
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    const { container } = panel();
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector("img")).toHaveAttribute("src", "/api/avatars/cafe1234feed5678.webp");
  });

  test("picking a file stages a crop and commits only on Save", async () => {
    uploadAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    const { container } = panel();
    pickFile();
    await waitFor(() => expect(container.querySelector("[data-testid='crop-stage']")).not.toBeNull());
    // Staged, not committed.
    expect(uploadAvatar).not.toHaveBeenCalled();

    loadCropperImage(container);
    await waitFor(() => expect(save()).toBeEnabled());
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(uploadAvatar).toHaveBeenCalled());
    expect(uploadAvatar.mock.calls[0]![0]).toBeInstanceOf(File);
    expect(cropToBlob).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  test("staging the Discord photo previews it and commits with sync on Save", async () => {
    syncAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    panel();
    fireEvent.click(screen.getByRole("button", { name: /use my discord photo/i }));
    expect(screen.getByAltText("")).toHaveAttribute("src", "https://cdn.discordapp.com/avatars/1/a.png");
    expect(syncAvatar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(syncAvatar).toHaveBeenCalled());
  });

  // Discord rotates its CDN links. A preview that won't load is the `provider_image_stale`
  // condition showing up BEFORE the commit instead of after it.
  test("a Discord preview that fails to load warns without blocking Save", async () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: /use my discord photo/i }));
    fireEvent.error(screen.getByAltText(""));
    expect(screen.getByText(/rotated your photo/i)).toBeInTheDocument();
    expect(save()).toBeEnabled(); // the server is the authority, not the preview
  });

  test("staging a removal shows the empty silhouette and commits with DELETE on Save", async () => {
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    removeAvatar.mockResolvedValue({ ok: true });
    const { container } = panel();
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    expect(container.querySelector("img")).toBeNull();
    expect(removeAvatar).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(removeAvatar).toHaveBeenCalled());
  });

  test("a failed save keeps the draft and does not report success", async () => {
    uploadAvatar.mockRejectedValue(new ApiError(400, "too_large"));
    const { container } = panel();
    pickFile();
    await waitFor(() => expect(container.querySelector("[data-testid='crop-stage']")).not.toBeNull());
    loadCropperImage(container);
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/too large/i));
    expect(onSaved).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='crop-stage']")).not.toBeNull();
  });

  // Finding #2: cropperRef.current.crop() rejects (bad canvas, failed webp encode, or a race
  // where the ref went stale) — this used to be an unhandled promise rejection: no message, no
  // error state, Save left enabled, and the user told nothing.
  test("a crop that fails to produce a blob announces the error and does not save", async () => {
    cropToBlob.mockRejectedValue(new Error("encode_failed"));
    const { container } = panel();
    pickFile();
    await waitFor(() => expect(container.querySelector("[data-testid='crop-stage']")).not.toBeNull());
    loadCropperImage(container);
    await waitFor(() => expect(save()).toBeEnabled());
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Something went wrong. Please try again."),
    );
    expect(uploadAvatar).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  // Finding #3: a corrupt file (or a non-image renamed to look like one) never fires `load` on
  // the cropper's <img> — onReady never fires, Save stays disabled forever, and without this the
  // user is told nothing about why. "loading, failed, empty and zero are four different renders."
  test("a file that fails to decode surfaces visibly and via the live region, without disabling the rest of the panel", async () => {
    const { container } = panel();
    pickFile();
    await waitFor(() => expect(container.querySelector("[data-testid='crop-stage']")).not.toBeNull());
    const img = container.querySelector("[data-testid='crop-stage'] img") as HTMLImageElement;
    fireEvent.error(img);
    expect(screen.getByRole("alert")).toHaveTextContent(/doesn't look like an image/i);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/doesn't look like an image/i),
    );
    expect(save()).toBeDisabled(); // never became croppable — correctly still disabled
    // The rest of the panel remains usable — the user can pick a different file instead of
    // being stuck.
    expect(screen.getByRole("button", { name: /choose a different image/i })).toBeEnabled();
  });

  // The dossier hero is server-rendered (RSC) and isn't reachable through query invalidation.
  test("a successful change also calls router.refresh, reaching the server-rendered hero", async () => {
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    removeAvatar.mockResolvedValue({ ok: true });
    panel();
    await waitFor(() => expect(screen.getByRole("button", { name: /remove photo/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Avatar removed"));
    expect(routerRefresh).toHaveBeenCalled();
  });

  // Finding #1 regression test: onSaved unmounts the panel (see Harness above) in the SAME
  // commit the success announcement is set. If the live region lived inside AvatarPanel, it
  // would unmount right along with the text change and nothing would ever be announced. Because
  // the harness keeps SrStatus mounted as a sibling, the text survives the panel's unmount.
  test("the success announcement survives the panel closing (the live region outlives the dialog)", async () => {
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    removeAvatar.mockResolvedValue({ ok: true });
    panel();
    await waitFor(() => expect(screen.getByRole("button", { name: /remove photo/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // The panel is gone (Save/Remove buttons unmounted along with it)...
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    // ...but the announcement it made is still in the document.
    expect(screen.getByRole("status")).toHaveTextContent("Avatar removed");
  });

  test("announces on settlement, never at click", async () => {
    let resolveRemove!: (v: { ok: true }) => void;
    removeAvatar.mockReturnValue(new Promise((r) => { resolveRemove = r; }));
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    panel();
    await waitFor(() => expect(screen.getByRole("button", { name: /remove photo/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    fireEvent.click(save());
    expect(screen.getByRole("status")).toHaveTextContent("");
    await act(async () => { resolveRemove({ ok: true }); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Avatar removed"));
  });

  // Two settlements landing on the SAME text must both announce; React bails on an equal state
  // update, so each mutation blanks the announcement in onMutate. Since a successful Save now
  // closes the dialog (finding #1's fix), the second settlement necessarily comes from a
  // REOPENED panel — the live region (owned by the harness, outside the panel) is what carries
  // the "blanked → same text again" transition across that reopen.
  test("a repeated outcome re-announces", async () => {
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    removeAvatar.mockResolvedValue({ ok: true });
    panel();
    await waitFor(() => expect(screen.getByRole("button", { name: /remove photo/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Avatar removed"));

    fireEvent.click(screen.getByRole("button", { name: /reopen/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /remove photo/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    fireEvent.click(save());
    expect(screen.getByRole("status")).toHaveTextContent(""); // blanked on start
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Avatar removed"));
  });
});
