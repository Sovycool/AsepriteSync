import { eq, desc, lt, and, count } from "drizzle-orm";
import type { Database } from "@asepritesync/db";
import { projects, projectMembers, users } from "@asepritesync/db";
import type { UserRole } from "@asepritesync/shared";
import { decodeCursor } from "../../lib/pagination.js";

export interface CreateProjectInput {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
}

export function createProjectsRepository(db: Database) {
  return {
    // ------------------------------------------------------------------
    // Projects
    // ------------------------------------------------------------------

    async listUserProjects(userId: string, cursor?: string, limit = 50) {
      const conditions = [eq(projectMembers.userId, userId)];
      if (cursor !== undefined) {
        conditions.push(lt(projects.createdAt, decodeCursor(cursor)));
      }

      return db
        .select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          ownerId: projects.ownerId,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt,
          role: projectMembers.role,
        })
        .from(projects)
        .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
        .where(and(...conditions))
        .orderBy(desc(projects.createdAt))
        .limit(limit + 1);
    },

    async findProjectById(id: string) {
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1);
      return project ?? null;
    },

    async getMemberCount(projectId: string): Promise<number> {
      const [row] = await db
        .select({ count: count() })
        .from(projectMembers)
        .where(eq(projectMembers.projectId, projectId));
      return row?.count ?? 0;
    },

    async createProject(input: CreateProjectInput) {
      return db.transaction(async (tx) => {
        const [project] = await tx
          .insert(projects)
          .values({
            id: input.id,
            name: input.name,
            description: input.description ?? null,
            ownerId: input.ownerId,
          })
          .returning();

        if (!project) throw new Error("Failed to create project");

        await tx.insert(projectMembers).values({
          projectId: project.id,
          userId: input.ownerId,
          role: "owner",
        });

        return project;
      });
    },

    async updateProject(id: string, input: UpdateProjectInput) {
      const [updated] = await db
        .update(projects)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, id))
        .returning();
      return updated ?? null;
    },

    async deleteProject(id: string) {
      await db.delete(projects).where(eq(projects.id, id));
    },

    // ------------------------------------------------------------------
    // Members
    // ------------------------------------------------------------------

    async findMemberRole(projectId: string, userId: string): Promise<UserRole | null> {
      const [row] = await db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, userId),
          ),
        )
        .limit(1);
      return row?.role ?? null;
    },

    async listMembers(projectId: string) {
      return db
        .select({
          projectId: projectMembers.projectId,
          userId: projectMembers.userId,
          role: projectMembers.role,
          createdAt: projectMembers.createdAt,
          username: users.username,
          avatarUrl: users.avatarUrl,
          email: users.email,
        })
        .from(projectMembers)
        .innerJoin(users, eq(users.id, projectMembers.userId))
        .where(eq(projectMembers.projectId, projectId))
        .orderBy(projectMembers.createdAt);
    },

    async findMember(projectId: string, userId: string) {
      const [row] = await db
        .select()
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, userId),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async addMember(projectId: string, userId: string, role: "editor" | "viewer") {
      const [row] = await db
        .insert(projectMembers)
        .values({ projectId, userId, role })
        .returning();
      return row ?? null;
    },

    async updateMemberRole(projectId: string, userId: string, role: "editor" | "viewer") {
      await db
        .update(projectMembers)
        .set({ role })
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, userId),
          ),
        );
    },

    async removeMember(projectId: string, userId: string) {
      await db
        .delete(projectMembers)
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, userId),
          ),
        );
    },

    // ------------------------------------------------------------------
    // User lookup (needed for invite-by-email)
    // ------------------------------------------------------------------

    async findUserByEmail(email: string) {
      const [user] = await db
        .select({ id: users.id, username: users.username, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return user ?? null;
    },
  };
}

export type ProjectsRepository = ReturnType<typeof createProjectsRepository>;
