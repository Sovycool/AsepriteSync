import { eq, desc, lt, lte, and, inArray, asc, notInArray, count, isNotNull } from "drizzle-orm";
import type { Database } from "@asepritesync/db";
import { files, fileVersions, projectMembers } from "@asepritesync/db";
import type { UserRole } from "@asepritesync/shared";
import { decodeCursor } from "../../lib/pagination.js";

export interface CreateFileInput {
  id: string;
  projectId: string;
  name: string;
  path: string;
}

export interface CreateVersionInput {
  id: string;
  fileId: string;
  versionNumber: number;
  authorId: string;
  hashSha256: string;
  sizeBytes: number;
  storagePath: string;
}

export function createFilesRepository(db: Database) {
  return {
    // ------------------------------------------------------------------
    // File listing
    // ------------------------------------------------------------------

    async listProjectFiles(projectId: string, cursor?: string, limit = 50) {
      const conditions = [eq(files.projectId, projectId)];
      if (cursor !== undefined) {
        conditions.push(lt(files.createdAt, decodeCursor(cursor)));
      }
      return db
        .select()
        .from(files)
        .where(and(...conditions))
        .orderBy(desc(files.createdAt))
        .limit(limit + 1);
    },

    // ------------------------------------------------------------------
    // Single-file lookups
    // ------------------------------------------------------------------

    async findFileById(id: string) {
      const [file] = await db.select().from(files).where(eq(files.id, id)).limit(1);
      return file ?? null;
    },

    /**
     * Returns the file and the requesting user's role in its project.
     * Returns null when the file doesn't exist OR the user is not a member.
     */
    async findFileWithRole(
      fileId: string,
      userId: string,
    ): Promise<{ file: typeof files.$inferSelect; role: UserRole } | null> {
      const [row] = await db
        .select({
          file: files,
          role: projectMembers.role,
        })
        .from(files)
        .innerJoin(projectMembers, eq(projectMembers.projectId, files.projectId))
        .where(and(eq(files.id, fileId), eq(projectMembers.userId, userId)))
        .limit(1);
      if (!row) return null;
      return { file: row.file, role: row.role };
    },

    /**
     * Returns files with the user's role, for batch operations.
     * Only returns files where the user is a member of the project.
     */
    async findFilesWithRole(
      fileIds: string[],
      userId: string,
    ): Promise<Array<{ file: typeof files.$inferSelect; role: UserRole }>> {
      if (fileIds.length === 0) return [];
      const rows = await db
        .select({ file: files, role: projectMembers.role })
        .from(files)
        .innerJoin(projectMembers, eq(projectMembers.projectId, files.projectId))
        .where(and(inArray(files.id, fileIds), eq(projectMembers.userId, userId)));
      return rows;
    },

    // ------------------------------------------------------------------
    // Versions
    // ------------------------------------------------------------------

    async findVersionById(id: string) {
      const [version] = await db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.id, id))
        .limit(1);
      return version ?? null;
    },

    async findAllVersions(fileId: string) {
      return db
        .select()
        .from(fileVersions)
        .where(eq(fileVersions.fileId, fileId))
        .orderBy(desc(fileVersions.versionNumber));
    },

    async getLatestVersionNumber(fileId: string): Promise<number> {
      const versions = await db
        .select({ n: fileVersions.versionNumber })
        .from(fileVersions)
        .where(eq(fileVersions.fileId, fileId))
        .orderBy(desc(fileVersions.versionNumber))
        .limit(1);
      return versions[0]?.n ?? 0;
    },

    // ------------------------------------------------------------------
    // Mutations
    // ------------------------------------------------------------------

    async createFile(input: CreateFileInput) {
      const [file] = await db.insert(files).values(input).returning();
      if (!file) throw new Error("Failed to create file record");
      return file;
    },

    async createVersion(input: CreateVersionInput) {
      const [version] = await db
        .insert(fileVersions)
        .values({ ...input, previewPath: null, isPinned: false })
        .returning();
      if (!version) throw new Error("Failed to create version record");
      return version;
    },

    async updateCurrentVersion(fileId: string, versionId: string) {
      await db
        .update(files)
        .set({ currentVersionId: versionId, updatedAt: new Date() })
        .where(eq(files.id, fileId));
    },

    async deleteFile(id: string) {
      await db.delete(files).where(eq(files.id, id));
    },

    // ------------------------------------------------------------------
    // Version history (T6)
    // ------------------------------------------------------------------

    async listVersionsPaginated(fileId: string, cursor?: string, limit = 50) {
      const conditions = [eq(fileVersions.fileId, fileId)];
      if (cursor !== undefined) {
        conditions.push(lt(fileVersions.createdAt, decodeCursor(cursor)));
      }
      return db
        .select()
        .from(fileVersions)
        .where(and(...conditions))
        .orderBy(desc(fileVersions.versionNumber))
        .limit(limit + 1);
    },

    async findVersionByFileAndNumber(fileId: string, versionNumber: number) {
      const [row] = await db
        .select()
        .from(fileVersions)
        .where(
          and(eq(fileVersions.fileId, fileId), eq(fileVersions.versionNumber, versionNumber)),
        )
        .limit(1);
      return row ?? null;
    },

    async countVersions(fileId: string): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(fileVersions)
        .where(eq(fileVersions.fileId, fileId));
      return row?.n ?? 0;
    },

    /**
     * Returns the oldest non-pinned versions that are NOT the current version,
     * up to `deleteCount` items, ordered oldest-first (FIFO eviction).
     */
    async findOldestEvictableVersions(
      fileId: string,
      currentVersionId: string,
      deleteCount: number,
    ) {
      return db
        .select()
        .from(fileVersions)
        .where(
          and(
            eq(fileVersions.fileId, fileId),
            eq(fileVersions.isPinned, false),
            notInArray(fileVersions.id, [currentVersionId]),
          ),
        )
        .orderBy(asc(fileVersions.versionNumber))
        .limit(deleteCount);
    },

    async deleteVersionsByIds(ids: string[]) {
      if (ids.length === 0) return;
      await db.delete(fileVersions).where(inArray(fileVersions.id, ids));
    },

    async updateVersionPreviewPath(versionId: string, previewPath: string) {
      await db
        .update(fileVersions)
        .set({ previewPath })
        .where(eq(fileVersions.id, versionId));
    },

    // ------------------------------------------------------------------
    // Locking (T7)
    // ------------------------------------------------------------------

    async lockFile(fileId: string, userId: string, expiresAt: Date) {
      const [updated] = await db
        .update(files)
        .set({ lockedBy: userId, lockExpiresAt: expiresAt, updatedAt: new Date() })
        .where(eq(files.id, fileId))
        .returning();
      return updated ?? null;
    },

    async unlockFile(fileId: string) {
      const [updated] = await db
        .update(files)
        .set({ lockedBy: null, lockExpiresAt: null, updatedAt: new Date() })
        .where(eq(files.id, fileId))
        .returning();
      return updated ?? null;
    },

    /**
     * Atomically clears all locks whose expiry is <= now.
     * Returns the fileId and projectId for each cleared lock (for WS broadcasting).
     */
    async clearExpiredLocks(): Promise<Array<{ fileId: string; projectId: string }>> {
      const now = new Date();
      const rows = await db
        .update(files)
        .set({ lockedBy: null, lockExpiresAt: null, updatedAt: now })
        .where(and(isNotNull(files.lockExpiresAt), lte(files.lockExpiresAt, now)))
        .returning({ fileId: files.id, projectId: files.projectId });
      return rows;
    },

    // ------------------------------------------------------------------
    // Project membership (for project-scoped file routes)
    // ------------------------------------------------------------------

    async findMemberRole(projectId: string, userId: string): Promise<UserRole | null> {
      const [row] = await db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
        )
        .limit(1);
      return row?.role ?? null;
    },
  };
}

export type FilesRepository = ReturnType<typeof createFilesRepository>;
