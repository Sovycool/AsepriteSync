import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useLockFile, useUnlockFile } from "../use-files";
import * as api from "@/lib/api";
import * as toastMod from "@/hooks/use-toast";
import type { FileRecord } from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN = "test-token";

vi.mock("@/contexts/auth", () => ({
  useAuth: () => ({ accessToken: TOKEN }),
}));

const mockFile: FileRecord = {
  id: "file-1",
  projectId: "proj-1",
  name: "sprite.aseprite",
  path: "/sprite.aseprite",
  currentVersionId: "v-1",
  lockedBy: null,
  lockExpiresAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

// ---------------------------------------------------------------------------
// useLockFile
// ---------------------------------------------------------------------------

describe("useLockFile", () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Seed cache with one unlocked file
    qc.setQueryData(["files", "proj-1"], [mockFile]);
  });

  it("calls filesApi.lock with the correct token and fileId", async () => {
    const lockSpy = vi.spyOn(api.filesApi, "lock").mockResolvedValue({
      fileId: "file-1",
      lockedBy: "user-1",
      lockExpiresAt: "2026-01-01T01:00:00Z",
    });

    const { result } = renderHook(() => useLockFile("proj-1"), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      result.current.mutate("file-1");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lockSpy).toHaveBeenCalledWith(TOKEN, "file-1");
  });

  it("updates the query cache with the new lockedBy value on success", async () => {
    vi.spyOn(api.filesApi, "lock").mockResolvedValue({
      fileId: "file-1",
      lockedBy: "user-1",
      lockExpiresAt: "2026-01-01T01:00:00Z",
    });

    const { result } = renderHook(() => useLockFile("proj-1"), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      result.current.mutate("file-1");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = qc.getQueryData<FileRecord[]>(["files", "proj-1"]);
    expect(cached?.[0]?.lockedBy).toBe("user-1");
  });

  it("calls toast on API failure", async () => {
    vi.spyOn(api.filesApi, "lock").mockRejectedValue(new Error("Already locked"));
    const toastSpy = vi.spyOn(toastMod, "toast").mockImplementation(() => "");

    const { result } = renderHook(() => useLockFile("proj-1"), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      result.current.mutate("file-1");
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", title: "Lock failed" }),
    );
  });
});

// ---------------------------------------------------------------------------
// useUnlockFile
// ---------------------------------------------------------------------------

describe("useUnlockFile", () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Seed cache with a file already locked by user-1
    qc.setQueryData(["files", "proj-1"], [
      { ...mockFile, lockedBy: "user-1", lockExpiresAt: "2026-01-01T01:00:00Z" },
    ]);
  });

  it("calls filesApi.unlock with the correct token and fileId", async () => {
    const unlockSpy = vi.spyOn(api.filesApi, "unlock").mockResolvedValue({
      fileId: "file-1",
      lockedBy: null,
      lockExpiresAt: null,
    });

    const { result } = renderHook(() => useUnlockFile("proj-1"), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      result.current.mutate("file-1");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(unlockSpy).toHaveBeenCalledWith(TOKEN, "file-1");
  });

  it("clears lockedBy in the query cache on success", async () => {
    vi.spyOn(api.filesApi, "unlock").mockResolvedValue({
      fileId: "file-1",
      lockedBy: null,
      lockExpiresAt: null,
    });

    const { result } = renderHook(() => useUnlockFile("proj-1"), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      result.current.mutate("file-1");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = qc.getQueryData<FileRecord[]>(["files", "proj-1"]);
    expect(cached?.[0]?.lockedBy).toBeNull();
  });

  it("calls toast on API failure", async () => {
    vi.spyOn(api.filesApi, "unlock").mockRejectedValue(new Error("Not locked"));
    const toastSpy = vi.spyOn(toastMod, "toast").mockImplementation(() => "");

    const { result } = renderHook(() => useUnlockFile("proj-1"), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      result.current.mutate("file-1");
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive", title: "Unlock failed" }),
    );
  });
});
