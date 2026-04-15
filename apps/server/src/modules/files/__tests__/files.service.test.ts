import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "node:stream";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../errors/index.js";
import { createFilesService } from "../files.service.js";
import type { FilesRepository } from "../files.repository.js";
import type { Database } from "@asepritesync/db";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../../lib/storage.js", () => ({
  storage: {
    save: vi.fn().mockResolvedValue({ hash: "abc123", sizeBytes: 1024 }),
    readStream: vi.fn().mockReturnValue(Readable.from(["data"])),
    delete: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../lib/activity.js", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../../../lib/ws-server.js", () => ({
  wsServer: {
    broadcast: vi.fn(),
    broadcastPresence: vi.fn(),
  },
}));


const mockDb = {} as unknown as Database;

const NOW = new Date("2024-01-01T00:00:00.000Z");

function makeFile(overrides = {}) {
  return {
    id: "file-1",
    projectId: "proj-1",
    name: "hero.aseprite",
    path: "/hero.aseprite",
    currentVersionId: "ver-1",
    lockedBy: null,
    lockExpiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeVersion(overrides = {}) {
  return {
    id: "ver-1",
    fileId: "file-1",
    versionNumber: 1,
    authorId: "user-1",
    hashSha256: "abc123",
    sizeBytes: 1024,
    storagePath: "proj-1/file-1/1.aseprite",
    previewPath: null,
    isPinned: false,
    createdAt: NOW,
    ...overrides,
  };
}

function makeLockResult(overrides = {}) {
  return {
    id: "file-1",
    lockedBy: "user-1",
    lockExpiresAt: new Date(Date.now() + 30 * 60_000),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<FilesRepository> = {}): FilesRepository {
  return {
    listProjectFiles: vi.fn().mockResolvedValue([]),
    findFileById: vi.fn().mockResolvedValue(makeFile()),
    findFileWithRole: vi.fn().mockResolvedValue({ file: makeFile(), role: "owner" }),
    findFilesWithRole: vi.fn().mockResolvedValue([]),
    findVersionById: vi.fn().mockResolvedValue(makeVersion()),
    findAllVersions: vi.fn().mockResolvedValue([makeVersion()]),
    getLatestVersionNumber: vi.fn().mockResolvedValue(1),
    createFile: vi.fn().mockImplementation(async (input) => ({
      ...makeFile(),
      ...input,
      currentVersionId: null,
    })),
    createVersion: vi.fn().mockImplementation(async (input) => ({
      ...makeVersion(),
      ...input,
    })),
    updateCurrentVersion: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    findMemberRole: vi.fn().mockResolvedValue("owner"),
    // T7
    lockFile: vi.fn().mockImplementation(async (_fid, userId, expiresAt) =>
      makeLockResult({ lockedBy: userId, lockExpiresAt: expiresAt }),
    ),
    unlockFile: vi.fn().mockResolvedValue(makeLockResult({ lockedBy: null, lockExpiresAt: null })),
    clearExpiredLocks: vi.fn().mockResolvedValue([] as Array<{ fileId: string; projectId: string }>),
    // T6
    listVersionsPaginated: vi.fn().mockResolvedValue([makeVersion()]),
    findVersionByFileAndNumber: vi.fn().mockResolvedValue(makeVersion()),
    countVersions: vi.fn().mockResolvedValue(1),
    findOldestEvictableVersions: vi.fn().mockResolvedValue([]),
    deleteVersionsByIds: vi.fn().mockResolvedValue(undefined),
    updateVersionPreviewPath: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FilesService", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("uploadFile", () => {
    it("throws ForbiddenError when user is not a member", async () => {
      const repo = makeRepo({ findMemberRole: vi.fn().mockResolvedValue(null) });
      const service = createFilesService(repo, mockDb);

      await expect(
        service.uploadFile("proj-1", "user-1", {
          filename: "test.aseprite",
          file: Readable.from([]),
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws ForbiddenError when viewer tries to upload", async () => {
      const repo = makeRepo({ findMemberRole: vi.fn().mockResolvedValue("viewer") });
      const service = createFilesService(repo, mockDb);

      await expect(
        service.uploadFile("proj-1", "user-1", {
          filename: "test.aseprite",
          file: Readable.from([]),
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws ValidationError for invalid file extension", async () => {
      const repo = makeRepo({ findMemberRole: vi.fn().mockResolvedValue("editor") });
      const service = createFilesService(repo, mockDb);

      await expect(
        service.uploadFile("proj-1", "user-1", {
          filename: "image.png",
          file: Readable.from([]),
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("creates file + version and returns serialized result", async () => {
      const repo = makeRepo({ findMemberRole: vi.fn().mockResolvedValue("editor") });
      const service = createFilesService(repo, mockDb);

      const result = await service.uploadFile("proj-1", "user-1", {
        filename: "hero.aseprite",
        file: Readable.from(["binary"]),
      });

      expect(result.name).toBe("hero.aseprite");
      expect(result.version.versionNumber).toBe(1);
      expect(repo.createFile).toHaveBeenCalledOnce();
      expect(repo.createVersion).toHaveBeenCalledOnce();
      expect(repo.updateCurrentVersion).toHaveBeenCalledOnce();
    });
  });

  describe("getFileStream", () => {
    it("throws NotFoundError when file does not exist or user not member", async () => {
      const repo = makeRepo({ findFileWithRole: vi.fn().mockResolvedValue(null) });
      const service = createFilesService(repo, mockDb);

      await expect(service.getFileStream("file-x", "user-1")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("throws NotFoundError when file has no current version", async () => {
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({
          file: makeFile({ currentVersionId: null }),
          role: "viewer",
        }),
      });
      const service = createFilesService(repo, mockDb);

      await expect(service.getFileStream("file-1", "user-1")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("returns filename, sizeBytes, and stream for valid file", async () => {
      const repo = makeRepo();
      const service = createFilesService(repo, mockDb);

      const result = await service.getFileStream("file-1", "user-1");
      expect(result.filename).toBe("hero.aseprite");
      expect(result.sizeBytes).toBe(1024);
      expect(result.stream).toBeDefined();
    });
  });

  describe("deleteFile", () => {
    it("throws NotFoundError when file does not exist", async () => {
      const repo = makeRepo({ findFileWithRole: vi.fn().mockResolvedValue(null) });
      const service = createFilesService(repo, mockDb);

      await expect(service.deleteFile("file-x", "user-1")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ForbiddenError when requester is not owner", async () => {
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({ file: makeFile(), role: "editor" }),
      });
      const service = createFilesService(repo, mockDb);

      await expect(service.deleteFile("file-1", "user-2")).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("deletes DB record and storage files", async () => {
      const { storage } = await import("../../../lib/storage.js");
      const repo = makeRepo();
      const service = createFilesService(repo, mockDb);

      await service.deleteFile("file-1", "user-1");

      expect(repo.deleteFile).toHaveBeenCalledWith("file-1");
      expect(storage.delete).toHaveBeenCalledWith("proj-1/file-1/1.aseprite");
    });
  });

  // -------------------------------------------------------------------------
  describe("updateFile (T6)", () => {
    it("throws ForbiddenError for viewers", async () => {
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({ file: makeFile(), role: "viewer" }),
      });
      const service = createFilesService(repo, mockDb);

      await expect(
        service.updateFile("file-1", "user-1", { filename: "hero.aseprite", file: Readable.from([]) }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws LockedError when file is locked by another user", async () => {
      const { LockedError } = await import("../../../errors/index.js");
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({
          file: makeFile({
            lockedBy: "other-user",
            lockExpiresAt: new Date(Date.now() + 60_000),
          }),
          role: "editor",
        }),
      });
      const service = createFilesService(repo, mockDb);

      await expect(
        service.updateFile("file-1", "user-1", { filename: "hero.aseprite", file: Readable.from([]) }),
      ).rejects.toBeInstanceOf(LockedError);
    });

    it("returns isDuplicate=true when hash matches current version", async () => {
      const { storage } = await import("../../../lib/storage.js");
      vi.mocked(storage.save).mockResolvedValueOnce({ hash: "abc123", sizeBytes: 1024 });

      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({ file: makeFile(), role: "editor" }),
        findVersionById: vi.fn().mockResolvedValue(makeVersion({ hashSha256: "abc123" })),
      });
      const service = createFilesService(repo, mockDb);

      const result = await service.updateFile("file-1", "user-1", {
        filename: "hero.aseprite",
        file: Readable.from([]),
      });

      expect(result.isDuplicate).toBe(true);
      expect(repo.createVersion).not.toHaveBeenCalled();
      expect(storage.delete).toHaveBeenCalled(); // duplicate discarded
    });

    it("creates a new version when hash differs", async () => {
      const { storage } = await import("../../../lib/storage.js");
      vi.mocked(storage.save).mockResolvedValueOnce({ hash: "newhash", sizeBytes: 2048 });

      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({ file: makeFile(), role: "editor" }),
        findVersionById: vi.fn().mockResolvedValue(makeVersion({ hashSha256: "oldhash" })),
        getLatestVersionNumber: vi.fn().mockResolvedValue(1),
        countVersions: vi.fn().mockResolvedValue(2),
      });
      const service = createFilesService(repo, mockDb);

      const result = await service.updateFile("file-1", "user-1", {
        filename: "hero.aseprite",
        file: Readable.from([]),
      });

      expect(result.isDuplicate).toBe(false);
      expect(result.version.versionNumber).toBe(2);
      expect(repo.createVersion).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  describe("lockFile (T7)", () => {
    afterEach(() => { vi.useRealTimers(); });

    it("throws ForbiddenError when viewer tries to lock", async () => {
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({ file: makeFile(), role: "viewer" }),
      });
      const service = createFilesService(repo, mockDb);

      await expect(service.lockFile("file-1", "user-1")).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws NotFoundError when file not found", async () => {
      const repo = makeRepo({ findFileWithRole: vi.fn().mockResolvedValue(null) });
      const service = createFilesService(repo, mockDb);

      await expect(service.lockFile("file-x", "user-1")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ConflictError when file is locked by another user", async () => {
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({
          file: makeFile({
            lockedBy: "other-user",
            lockExpiresAt: new Date(Date.now() + 60_000),
          }),
          role: "editor",
        }),
      });
      const service = createFilesService(repo, mockDb);

      const { ConflictError } = await import("../../../errors/index.js");
      await expect(service.lockFile("file-1", "user-1")).rejects.toBeInstanceOf(ConflictError);
    });

    it("allows acquiring a lock when the previous lock has expired", async () => {
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({
          file: makeFile({
            lockedBy: "other-user",
            lockExpiresAt: new Date(Date.now() - 1_000), // already expired
          }),
          role: "editor",
        }),
      });
      const service = createFilesService(repo, mockDb);

      const result = await service.lockFile("file-1", "user-1");
      expect(result.lockedBy).toBe("user-1");
      expect(repo.lockFile).toHaveBeenCalledOnce();
    });

    it("renews lock (heartbeat) when same user re-locks", async () => {
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({
          file: makeFile({
            lockedBy: "user-1",
            lockExpiresAt: new Date(Date.now() + 5_000), // almost expired
          }),
          role: "editor",
        }),
      });
      const service = createFilesService(repo, mockDb);

      const result = await service.lockFile("file-1", "user-1");
      expect(result.lockedBy).toBe("user-1");
      expect(repo.lockFile).toHaveBeenCalledOnce();
    });

    it("acquires lock on an unlocked file", async () => {
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({ file: makeFile(), role: "editor" }),
      });
      const service = createFilesService(repo, mockDb);

      const result = await service.lockFile("file-1", "user-1");
      expect(result.lockedBy).toBe("user-1");
      expect(result.lockExpiresAt).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("unlockFile (T7)", () => {
    it("throws NotFoundError when file not found", async () => {
      const repo = makeRepo({ findFileWithRole: vi.fn().mockResolvedValue(null) });
      const service = createFilesService(repo, mockDb);

      await expect(service.unlockFile("file-x", "user-1")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("returns successfully (idempotent) when file is not locked", async () => {
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({ file: makeFile(), role: "editor" }),
      });
      const service = createFilesService(repo, mockDb);

      const result = await service.unlockFile("file-1", "user-1");
      expect(result.lockedBy).toBeNull();
      expect(repo.unlockFile).not.toHaveBeenCalled();
    });

    it("throws ForbiddenError when non-owner/non-lock-holder tries to unlock", async () => {
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({
          file: makeFile({ lockedBy: "other-user", lockExpiresAt: new Date(Date.now() + 60_000) }),
          role: "editor",
        }),
      });
      const service = createFilesService(repo, mockDb);

      await expect(service.unlockFile("file-1", "user-1")).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("allows lock owner to unlock their own lock", async () => {
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({
          file: makeFile({ lockedBy: "user-1", lockExpiresAt: new Date(Date.now() + 60_000) }),
          role: "editor",
        }),
      });
      const service = createFilesService(repo, mockDb);

      const result = await service.unlockFile("file-1", "user-1");
      expect(repo.unlockFile).toHaveBeenCalledWith("file-1");
      expect(result.lockedBy).toBeNull();
    });

    it("allows project owner to unlock another user's lock", async () => {
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({
          file: makeFile({ lockedBy: "other-user", lockExpiresAt: new Date(Date.now() + 60_000) }),
          role: "owner",
        }),
      });
      const service = createFilesService(repo, mockDb);

      const result = await service.unlockFile("file-1", "user-1");
      expect(repo.unlockFile).toHaveBeenCalledWith("file-1");
      expect(result.lockedBy).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("getPreviewStream (T13)", () => {
    it("throws NotFoundError when file is not found", async () => {
      const repo = makeRepo({ findFileWithRole: vi.fn().mockResolvedValue(null) });
      const service = createFilesService(repo, mockDb);

      await expect(service.getPreviewStream("file-x", "user-1")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws NotFoundError when file has no currentVersionId", async () => {
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({
          file: makeFile({ currentVersionId: null }),
          role: "viewer",
        }),
      });
      const service = createFilesService(repo, mockDb);

      await expect(service.getPreviewStream("file-1", "user-1")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws NotFoundError when version has no previewPath", async () => {
      const repo = makeRepo({
        findVersionById: vi.fn().mockResolvedValue(makeVersion({ previewPath: null })),
      });
      const service = createFilesService(repo, mockDb);

      await expect(service.getPreviewStream("file-1", "user-1")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("returns a readable stream when previewPath exists", async () => {
      const { storage } = await import("../../../lib/storage.js");
      const repo = makeRepo({
        findVersionById: vi.fn().mockResolvedValue(
          makeVersion({ previewPath: "proj-1/file-1/preview.png" }),
        ),
      });
      const service = createFilesService(repo, mockDb);

      const result = await service.getPreviewStream("file-1", "user-1");

      expect(storage.readStream).toHaveBeenCalledWith("proj-1/file-1/preview.png");
      expect(result.stream).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  describe("restoreVersion (T6)", () => {
    it("throws ForbiddenError for viewers", async () => {
      const repo = makeRepo({
        findFileWithRole: vi.fn().mockResolvedValue({ file: makeFile(), role: "viewer" }),
      });
      const service = createFilesService(repo, mockDb);

      await expect(
        service.restoreVersion("file-1", "user-1", 1),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws NotFoundError for unknown version number", async () => {
      const repo = makeRepo({
        findVersionByFileAndNumber: vi.fn().mockResolvedValue(null),
      });
      const service = createFilesService(repo, mockDb);

      await expect(
        service.restoreVersion("file-1", "user-1", 99),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("creates a copy as a new version and updates current pointer", async () => {
      const { storage } = await import("../../../lib/storage.js");
      const repo = makeRepo({
        getLatestVersionNumber: vi.fn().mockResolvedValue(3),
      });
      const service = createFilesService(repo, mockDb);

      const restored = await service.restoreVersion("file-1", "user-1", 1);

      expect(storage.copy).toHaveBeenCalled();
      expect(restored.versionNumber).toBe(4);
      expect(repo.updateCurrentVersion).toHaveBeenCalledOnce();
    });
  });
});
