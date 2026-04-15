import { describe, it, expect, vi, beforeEach } from "vitest";
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
  },
}));

vi.mock("../../../lib/activity.js", () => ({
  logActivity: vi.fn(),
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
});
