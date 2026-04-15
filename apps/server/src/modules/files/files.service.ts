import crypto from "node:crypto";
import path from "node:path";
import type { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import type { Database } from "@asepritesync/db";
import { users } from "@asepritesync/db";
import {
  ConflictError,
  ForbiddenError,
  LockedError,
  NotFoundError,
  ValidationError,
} from "../../errors/index.js";
import { config } from "../../config.js";
import { logActivity } from "../../lib/activity.js";
import { encodeCursor, paginate } from "../../lib/pagination.js";
import { readAsepriteMetadata } from "../../lib/aseprite-parser.js";
import { storage } from "../../lib/storage.js";
import { wsServer } from "../../lib/ws-server.js";
import { enqueuePreviewJob } from "../../jobs/preview-job.js";
import type { FilesRepository } from "./files.repository.js";
import { ALLOWED_EXTENSIONS } from "./files.schema.js";
import type { ListFilesQuery, BatchDownloadInput } from "./files.schema.js";

export interface UploadedFile {
  filename: string;
  file: Readable;
}

export function createFilesService(repo: FilesRepository, db: Database) {
  return {
    // ------------------------------------------------------------------
    // List files in a project
    // ------------------------------------------------------------------

    async listProjectFiles(projectId: string, requesterId: string, query: ListFilesQuery) {
      const role = await repo.findMemberRole(projectId, requesterId);
      if (role === null) throw new ForbiddenError("You are not a member of this project");

      const raw = await repo.listProjectFiles(projectId, query.cursor, query.limit);
      const { items, pageInfo } = paginate(raw, query.limit);

      return {
        files: items.map(serializeFile),
        meta: { cursor: pageInfo.cursor, hasMore: pageInfo.hasMore },
      };
    },

    // ------------------------------------------------------------------
    // Upload a new file to a project
    // ------------------------------------------------------------------

    async uploadFile(
      projectId: string,
      requesterId: string,
      upload: UploadedFile,
    ) {
      // Authorization: editor or owner
      const role = await repo.findMemberRole(projectId, requesterId);
      if (role === null) throw new ForbiddenError("You are not a member of this project");
      if (role === "viewer") throw new ForbiddenError("Viewers cannot upload files");

      // Validate extension
      const ext = path.extname(upload.filename).toLowerCase();
      if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
        throw new ValidationError(
          `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`,
        );
      }

      const fileId = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      const storagePath = `${projectId}/${fileId}/1.aseprite`;

      // Save to disk (computes SHA-256 + size in one pass)
      const { hash, sizeBytes } = await storage.save(storagePath, upload.file);

      // Extract Aseprite metadata from the stored file header (non-blocking read)
      const absStoragePath = path.join(config.STORAGE_PATH, storagePath);
      const metadata = await readAsepriteMetadata(absStoragePath);

      // Insert file record (currentVersionId set after version insert)
      const file = await repo.createFile({
        id: fileId,
        projectId,
        name: upload.filename,
        path: `/${upload.filename}`,
      });

      // Insert version record
      const version = await repo.createVersion({
        id: versionId,
        fileId,
        versionNumber: 1,
        authorId: requesterId,
        hashSha256: hash,
        sizeBytes,
        storagePath,
      });

      // Link file → version
      await repo.updateCurrentVersion(fileId, versionId);

      logActivity(db, {
        userId: requesterId,
        projectId,
        action: "file:uploaded",
        targetType: "file",
        targetId: fileId,
        metadata: { name: upload.filename, sizeBytes, versionId },
      });

      // WebSocket broadcast — fire-and-forget
      void getUsernameById(db, requesterId).then((username) => {
        wsServer.broadcast(projectId, "file:uploaded", {
          fileId,
          name: upload.filename,
          userId: requesterId,
          username,
        });
      });

      // Background preview generation
      enqueuePreviewJob({ db, repo, projectId, fileId, versionId, storagePath });

      return {
        ...serializeFile({ ...file, currentVersionId: versionId }),
        version: serializeVersion(version),
        ...(metadata !== null && { metadata }),
      };
    },

    // ------------------------------------------------------------------
    // Download a file (stream)
    // ------------------------------------------------------------------

    async getFileStream(fileId: string, requesterId: string) {
      const result = await repo.findFileWithRole(fileId, requesterId);
      if (result === null) throw new NotFoundError("File", fileId);

      const { file } = result;
      if (file.currentVersionId === null) {
        throw new NotFoundError("File has no versions");
      }

      const version = await repo.findVersionById(file.currentVersionId);
      if (version === null) throw new NotFoundError("FileVersion", file.currentVersionId);

      return {
        filename: file.name,
        sizeBytes: version.sizeBytes,
        stream: storage.readStream(version.storagePath),
      };
    },

    // ------------------------------------------------------------------
    // File metadata — GET /files/:id/info
    // ------------------------------------------------------------------

    async getFileMeta(fileId: string, requesterId: string) {
      const result = await repo.findFileWithRole(fileId, requesterId);
      if (result === null) throw new NotFoundError("File", fileId);
      return serializeFile(result.file);
    },

    // ------------------------------------------------------------------
    // Preview thumbnail — GET /files/:id/preview  (T13)
    // ------------------------------------------------------------------

    async getPreviewStream(fileId: string, requesterId: string) {
      const result = await repo.findFileWithRole(fileId, requesterId);
      if (result === null) throw new NotFoundError("File", fileId);

      const { file } = result;
      if (file.currentVersionId === null) throw new NotFoundError("File has no versions");

      const version = await repo.findVersionById(file.currentVersionId);
      if (version === null) throw new NotFoundError("FileVersion", file.currentVersionId);
      if (version.previewPath === null) throw new NotFoundError("Preview not yet generated");

      return { stream: storage.readStream(version.previewPath) };
    },

    // ------------------------------------------------------------------
    // Upload a manual preview image — POST /files/:id/preview
    // ------------------------------------------------------------------

    async setPreview(fileId: string, requesterId: string, upload: UploadedFile) {
      const result = await repo.findFileWithRole(fileId, requesterId);
      if (result === null) throw new NotFoundError("File", fileId);

      const { file, role } = result;
      if (role === "viewer") throw new ForbiddenError("Viewers cannot set file previews");
      if (file.currentVersionId === null) throw new NotFoundError("File has no versions");

      // Validate image extension
      const ext = path.extname(upload.filename).toLowerCase();
      const ALLOWED_PREVIEW_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
      if (!ALLOWED_PREVIEW_EXTS.includes(ext)) {
        throw new ValidationError(
          `Invalid preview type. Allowed: ${ALLOWED_PREVIEW_EXTS.join(", ")}`,
        );
      }

      const previewPath = `${file.projectId}/${fileId}/preview${ext}`;
      await storage.save(previewPath, upload.file);
      await repo.updateVersionPreviewPath(file.currentVersionId, previewPath);

      return { fileId, previewPath };
    },

    // ------------------------------------------------------------------
    // Delete a file (owner only)
    // ------------------------------------------------------------------

    async deleteFile(fileId: string, requesterId: string) {
      const result = await repo.findFileWithRole(fileId, requesterId);
      if (result === null) throw new NotFoundError("File", fileId);

      if (result.role !== "owner") {
        throw new ForbiddenError("Only the project owner can delete files");
      }

      // Collect storage paths before deleting DB records
      const versions = await repo.findAllVersions(fileId);

      // Delete DB record (cascades to file_versions)
      await repo.deleteFile(fileId);

      // Delete stored binaries (best-effort)
      for (const v of versions) {
        await storage.delete(v.storagePath).catch((e: unknown) => {
          console.error(`[storage] Failed to delete ${v.storagePath}:`, e);
        });
      }

      logActivity(db, {
        userId: requesterId,
        projectId: result.file.projectId,
        action: "file:deleted",
        targetType: "file",
        targetId: fileId,
        metadata: { name: result.file.name },
      });

      wsServer.broadcast(result.file.projectId, "file:deleted", { fileId });
    },

    // ------------------------------------------------------------------
    // Batch download (ZIP)
    // ------------------------------------------------------------------

    async getBatchStreams(requesterId: string, input: BatchDownloadInput) {
      const rows = await repo.findFilesWithRole(input.fileIds, requesterId);

      // Verify all requested IDs were found (user is member of each project)
      const foundIds = new Set(rows.map((r) => r.file.id));
      const missing = input.fileIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new NotFoundError(
          `Files not found or inaccessible: ${missing.join(", ")}`,
        );
      }

      // Resolve current versions
      const entries: Array<{ filename: string; storagePath: string }> = [];

      for (const { file } of rows) {
        if (file.currentVersionId === null) continue;
        const version = await repo.findVersionById(file.currentVersionId);
        if (version === null) continue;
        entries.push({ filename: file.name, storagePath: version.storagePath });
      }

      return entries;
    },

    // ------------------------------------------------------------------
    // Update file — PUT /files/:id  (T6)
    // ------------------------------------------------------------------

    async updateFile(
      fileId: string,
      requesterId: string,
      upload: UploadedFile,
    ) {
      const result = await repo.findFileWithRole(fileId, requesterId);
      if (result === null) throw new NotFoundError("File", fileId);

      const { file, role } = result;

      // Authorization: editor or owner
      if (role === "viewer") throw new ForbiddenError("Viewers cannot update files");

      // Lock check: if locked by someone else and not expired, deny
      const now = new Date();
      if (
        file.lockedBy !== null &&
        file.lockedBy !== requesterId &&
        file.lockExpiresAt !== null &&
        file.lockExpiresAt > now
      ) {
        throw new LockedError("File is locked by another user", {
          lockedBy: file.lockedBy,
          lockExpiresAt: file.lockExpiresAt.toISOString(),
        });
      }

      // Validate extension
      const ext = path.extname(upload.filename).toLowerCase();
      if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
        throw new ValidationError(
          `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`,
        );
      }

      const latestVersionNumber = await repo.getLatestVersionNumber(fileId);
      const newVersionNumber = latestVersionNumber + 1;
      const newVersionId = crypto.randomUUID();
      const storagePath = `${file.projectId}/${fileId}/${newVersionNumber}.aseprite`;

      // Save upload + compute hash/size
      const { hash, sizeBytes } = await storage.save(storagePath, upload.file);

      // Deduplication: if hash matches current version, discard and return 200
      if (file.currentVersionId !== null) {
        const currentVersion = await repo.findVersionById(file.currentVersionId);
        if (currentVersion !== null && currentVersion.hashSha256 === hash) {
          // Clean up the just-saved duplicate file
          await storage.delete(storagePath);
          return { file: serializeFile(file), version: serializeVersion(currentVersion), isDuplicate: true };
        }
      }

      // Create new version record
      const version = await repo.createVersion({
        id: newVersionId,
        fileId,
        versionNumber: newVersionNumber,
        authorId: requesterId,
        hashSha256: hash,
        sizeBytes,
        storagePath,
      });

      // Update current version pointer
      await repo.updateCurrentVersion(fileId, newVersionId);

      // FIFO cleanup: evict oldest non-pinned versions over the limit
      const totalVersions = await repo.countVersions(fileId);
      const maxVersions = Number(process.env["MAX_VERSIONS_PER_FILE"] ?? 50);
      if (totalVersions > maxVersions) {
        const excess = totalVersions - maxVersions;
        const toEvict = await repo.findOldestEvictableVersions(fileId, newVersionId, excess);
        await repo.deleteVersionsByIds(toEvict.map((v) => v.id));
        for (const v of toEvict) {
          await storage.delete(v.storagePath).catch((e: unknown) => {
            console.error(`[storage] eviction failed for ${v.storagePath}:`, e);
          });
        }
      }

      logActivity(db, {
        userId: requesterId,
        projectId: file.projectId,
        action: "file:updated",
        targetType: "file",
        targetId: fileId,
        metadata: { versionNumber: newVersionNumber, sizeBytes },
      });

      void getUsernameById(db, requesterId).then((username) => {
        wsServer.broadcast(file.projectId, "file:updated", {
          fileId,
          version: newVersionNumber,
          userId: requesterId,
          username,
        });
      });

      // Background preview generation
      enqueuePreviewJob({
        db,
        repo,
        projectId: file.projectId,
        fileId,
        versionId: newVersionId,
        storagePath,
      });

      // Extract metadata from the new version
      const absStoragePath = path.join(config.STORAGE_PATH, storagePath);
      const metadata = await readAsepriteMetadata(absStoragePath);

      return {
        file: serializeFile({ ...file, currentVersionId: newVersionId }),
        version: serializeVersion(version),
        isDuplicate: false,
        ...(metadata !== null && { metadata }),
      };
    },

    // ------------------------------------------------------------------
    // Version history — GET /files/:id/versions  (T6)
    // ------------------------------------------------------------------

    async listVersions(fileId: string, requesterId: string, query: ListFilesQuery) {
      const result = await repo.findFileWithRole(fileId, requesterId);
      if (result === null) throw new NotFoundError("File", fileId);

      const raw = await repo.listVersionsPaginated(fileId, query.cursor, query.limit);
      const { items, pageInfo } = paginate(raw, query.limit);

      return {
        versions: items.map(serializeVersion),
        meta: { cursor: pageInfo.cursor, hasMore: pageInfo.hasMore },
      };
    },

    // ------------------------------------------------------------------
    // Restore version — POST /files/:id/versions/:v/restore  (T6)
    // ------------------------------------------------------------------

    async restoreVersion(fileId: string, requesterId: string, versionNumber: number) {
      const result = await repo.findFileWithRole(fileId, requesterId);
      if (result === null) throw new NotFoundError("File", fileId);

      const { file, role } = result;
      if (role === "viewer") throw new ForbiddenError("Viewers cannot restore versions");

      const targetVersion = await repo.findVersionByFileAndNumber(fileId, versionNumber);
      if (targetVersion === null) {
        throw new NotFoundError(`Version ${versionNumber.toString()} of file`);
      }

      // Create a new version that copies the target version's file content
      const latestVersionNumber = await repo.getLatestVersionNumber(fileId);
      const newVersionNumber = latestVersionNumber + 1;
      const newVersionId = crypto.randomUUID();
      const newStoragePath = `${file.projectId}/${fileId}/${newVersionNumber}.aseprite`;

      await storage.copy(targetVersion.storagePath, newStoragePath);

      const newVersion = await repo.createVersion({
        id: newVersionId,
        fileId,
        versionNumber: newVersionNumber,
        authorId: requesterId,
        hashSha256: targetVersion.hashSha256,
        sizeBytes: targetVersion.sizeBytes,
        storagePath: newStoragePath,
      });

      await repo.updateCurrentVersion(fileId, newVersionId);

      logActivity(db, {
        userId: requesterId,
        projectId: file.projectId,
        action: "file:restored",
        targetType: "file",
        targetId: fileId,
        metadata: { restoredFromVersion: versionNumber, newVersion: newVersionNumber },
      });

      return serializeVersion(newVersion);
    },

    // ------------------------------------------------------------------
    // Lock file — POST /files/:id/lock  (T7)
    // ------------------------------------------------------------------

    async lockFile(fileId: string, requesterId: string) {
      const result = await repo.findFileWithRole(fileId, requesterId);
      if (result === null) throw new NotFoundError("File", fileId);

      const { file, role } = result;
      if (role === "viewer") throw new ForbiddenError("Viewers cannot lock files");

      const now = new Date();
      const expiresAt = new Date(now.getTime() + config.LOCK_DURATION_MINUTES * 60_000);

      // Heartbeat: same user already holds the lock → renew it
      if (file.lockedBy === requesterId) {
        const updated = await repo.lockFile(fileId, requesterId, expiresAt);
        if (!updated) throw new NotFoundError("File", fileId);
        return serializeLock(updated);
      }

      // Conflict: another user holds an unexpired lock
      if (
        file.lockedBy !== null &&
        file.lockExpiresAt !== null &&
        file.lockExpiresAt > now
      ) {
        throw new ConflictError("File is already locked by another user", {
          lockedBy: file.lockedBy,
          lockExpiresAt: file.lockExpiresAt.toISOString(),
        });
      }

      // Lock is free (or expired) — acquire it
      const updated = await repo.lockFile(fileId, requesterId, expiresAt);
      if (!updated) throw new NotFoundError("File", fileId);

      logActivity(db, {
        userId: requesterId,
        projectId: file.projectId,
        action: "file:locked",
        targetType: "file",
        targetId: fileId,
        metadata: { lockedBy: requesterId, lockExpiresAt: expiresAt.toISOString() },
      });

      void getUsernameById(db, requesterId).then((username) => {
        wsServer.broadcast(file.projectId, "file:locked", {
          fileId,
          userId: requesterId,
          username,
          expiresAt: expiresAt.toISOString(),
        });
      });

      return serializeLock(updated);
    },

    // ------------------------------------------------------------------
    // Unlock file — DELETE /files/:id/lock  (T7)
    // ------------------------------------------------------------------

    async unlockFile(fileId: string, requesterId: string) {
      const result = await repo.findFileWithRole(fileId, requesterId);
      if (result === null) throw new NotFoundError("File", fileId);

      const { file, role } = result;

      // Not locked → idempotent success
      if (file.lockedBy === null) {
        return serializeLock(file);
      }

      // Only lock owner or project owner may unlock
      if (file.lockedBy !== requesterId && role !== "owner") {
        throw new ForbiddenError("Only the lock owner or project owner can unlock this file");
      }

      const updated = await repo.unlockFile(fileId);
      if (!updated) throw new NotFoundError("File", fileId);

      logActivity(db, {
        userId: requesterId,
        projectId: file.projectId,
        action: "file:unlocked",
        targetType: "file",
        targetId: fileId,
        metadata: { unlockedBy: requesterId },
      });

      wsServer.broadcast(file.projectId, "file:unlocked", { fileId });

      return serializeLock(updated);
    },
  };
}

export type FilesService = ReturnType<typeof createFilesService>;

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

/** Fetches a user's username for WS event payloads. Falls back to "unknown" on any failure. */
async function getUsernameById(db: Database, userId: string): Promise<string> {
  try {
    const [user] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user?.username ?? "unknown";
  } catch {
    return "unknown";
  }
}

function serializeLock(f: {
  id: string;
  lockedBy: string | null;
  lockExpiresAt: Date | null;
}) {
  return {
    fileId: f.id,
    lockedBy: f.lockedBy,
    lockExpiresAt: f.lockExpiresAt?.toISOString() ?? null,
  };
}

function serializeFile(f: {
  id: string;
  projectId: string;
  name: string;
  path: string;
  currentVersionId: string | null;
  lockedBy: string | null;
  lockExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: f.id,
    projectId: f.projectId,
    name: f.name,
    path: f.path,
    currentVersionId: f.currentVersionId,
    lockedBy: f.lockedBy,
    lockExpiresAt: f.lockExpiresAt?.toISOString() ?? null,
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

function serializeVersion(v: {
  id: string;
  fileId: string;
  versionNumber: number;
  authorId: string;
  hashSha256: string;
  sizeBytes: number;
  storagePath: string;
  previewPath: string | null;
  isPinned: boolean;
  createdAt: Date;
}) {
  return {
    id: v.id,
    fileId: v.fileId,
    versionNumber: v.versionNumber,
    authorId: v.authorId,
    hashSha256: v.hashSha256,
    sizeBytes: v.sizeBytes,
    previewPath: v.previewPath,
    isPinned: v.isPinned,
    createdAt: v.createdAt.toISOString(),
  };
}
