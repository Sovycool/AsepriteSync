import { eq, desc, lt, and, inArray } from "drizzle-orm";
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
