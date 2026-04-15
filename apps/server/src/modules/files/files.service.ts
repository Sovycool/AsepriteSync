import crypto from "node:crypto";
import path from "node:path";
import type { Readable } from "node:stream";
import type { Database } from "@asepritesync/db";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../errors/index.js";
import { logActivity } from "../../lib/activity.js";
import { encodeCursor, paginate } from "../../lib/pagination.js";
import { storage } from "../../lib/storage.js";
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

      return {
        ...serializeFile({ ...file, currentVersionId: versionId }),
        version: serializeVersion(version),
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
  };
}

export type FilesService = ReturnType<typeof createFilesService>;

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

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
  createdAt: Date;
}) {
  return {
    id: v.id,
    fileId: v.fileId,
    versionNumber: v.versionNumber,
    authorId: v.authorId,
    hashSha256: v.hashSha256,
    sizeBytes: v.sizeBytes,
    createdAt: v.createdAt.toISOString(),
  };
}
