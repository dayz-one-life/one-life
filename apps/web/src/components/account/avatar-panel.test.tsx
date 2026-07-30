import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { AvatarPanel } from "./avatar-panel";
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

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const panel = () => wrap(<AvatarPanel onSaved={onSaved} cropToBlob={cropToBlob} />);

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
  // update, so each mutation blanks the announcement in onMutate.
  test("a repeated outcome re-announces", async () => {
    getAvatar.mockResolvedValue({ hash: "cafe1234feed5678" });
    removeAvatar.mockResolvedValue({ ok: true });
    panel();
    await waitFor(() => expect(screen.getByRole("button", { name: /remove photo/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    await act(async () => { fireEvent.click(save()); });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Avatar removed"));

    fireEvent.click(screen.getByRole("button", { name: /remove photo/i }));
    fireEvent.click(save());
    expect(screen.getByRole("status")).toHaveTextContent(""); // blanked on start
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Avatar removed"));
  });
});
