import crypto from "node:crypto";
import type { Database } from "@asepritesync/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../errors/index.js";
import { logActivity } from "../../lib/activity.js";
import { encodeCursor, paginate } from "../../lib/pagination.js";
import type { ProjectsRepository } from "./projects.repository.js";
import type {
  CreateProjectInput,
  UpdateProjectInput,
  InviteMemberInput,
  UpdateMemberRoleInput,
  ListQueryInput,
} from "./projects.schema.js";

export function createProjectsService(repo: ProjectsRepository, db: Database) {
  return {
    // ------------------------------------------------------------------
    // Projects
    // ------------------------------------------------------------------

    async listUserProjects(userId: string, query: ListQueryInput) {
      const raw = await repo.listUserProjects(userId, query.cursor, query.limit);
      const { items, pageInfo } = paginate(raw, query.limit);

      return {
        projects: items.map(serializeProjectRow),
        meta: {
          cursor: pageInfo.cursor,
          hasMore: pageInfo.hasMore,
        },
      };
    },

    async getProject(projectId: string, requesterId: string) {
      const [project, role, memberCount] = await Promise.all([
        repo.findProjectById(projectId),
        repo.findMemberRole(projectId, requesterId),
        repo.getMemberCount(projectId),
      ]);

      if (project === null) throw new NotFoundError("Project", projectId);
      if (role === null) throw new ForbiddenError("You are not a member of this project");

      return { ...serializeProject(project), memberCount, role };
    },

    async createProject(userId: string, input: CreateProjectInput) {
      const project = await repo.createProject({
        id: crypto.randomUUID(),
        name: input.name,
        ownerId: userId,
        ...(input.description !== undefined && { description: input.description }),
      });

      logActivity(db, {
        userId,
        projectId: project.id,
        action: "project:created",
        targetType: "project",
        targetId: project.id,
        metadata: { name: project.name },
      });

      return { ...serializeProject(project), memberCount: 1, role: "owner" as const };
    },

    async updateProject(projectId: string, requesterId: string, input: UpdateProjectInput) {
      await assertOwner(repo, projectId, requesterId);

      const updated = await repo.updateProject(projectId, {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
      });
      if (updated === null) throw new NotFoundError("Project", projectId);

      logActivity(db, {
        userId: requesterId,
        projectId,
        action: "project:updated",
        targetType: "project",
        targetId: projectId,
        metadata: input as Record<string, unknown>,
      });

      const memberCount = await repo.getMemberCount(projectId);
      return { ...serializeProject(updated), memberCount, role: "owner" as const };
    },

    async deleteProject(projectId: string, requesterId: string) {
      await assertOwner(repo, projectId, requesterId);
      await repo.deleteProject(projectId);
      // Activity is cascade-deleted with the project
    },

    // ------------------------------------------------------------------
    // Members
    // ------------------------------------------------------------------

    async listMembers(projectId: string, requesterId: string) {
      const role = await repo.findMemberRole(projectId, requesterId);
      if (role === null) throw new ForbiddenError("You are not a member of this project");

      const members = await repo.listMembers(projectId);
      return members.map(serializeMember);
    },

    async inviteMember(
      projectId: string,
      requesterId: string,
      input: InviteMemberInput,
    ) {
      const requesterRole = await repo.findMemberRole(projectId, requesterId);
      if (requesterRole === null) {
        throw new ForbiddenError("You are not a member of this project");
      }
      if (requesterRole === "viewer") {
        throw new ForbiddenError("Viewers cannot invite members");
      }

      const invitedUser = await repo.findUserByEmail(input.email);
      if (invitedUser === null) {
        throw new NotFoundError("User", undefined);
      }

      const existing = await repo.findMember(projectId, invitedUser.id);
      if (existing !== null) {
        throw new ConflictError("User is already a member of this project");
      }

      await repo.addMember(projectId, invitedUser.id, input.role);

      logActivity(db, {
        userId: requesterId,
        projectId,
        action: "member:joined",
        targetType: "user",
        targetId: invitedUser.id,
        metadata: { role: input.role, invitedBy: requesterId },
      });

      return {
        projectId,
        userId: invitedUser.id,
        username: invitedUser.username,
        avatarUrl: invitedUser.avatarUrl,
        role: input.role,
      };
    },

    async updateMemberRole(
      projectId: string,
      requesterId: string,
      targetUserId: string,
      input: UpdateMemberRoleInput,
    ) {
      await assertOwner(repo, projectId, requesterId);

      if (requesterId === targetUserId) {
        throw new ValidationError("You cannot change your own role");
      }

      const target = await repo.findMember(projectId, targetUserId);
      if (target === null) {
        throw new NotFoundError("Member", targetUserId);
      }
      if (target.role === "owner") {
        throw new ValidationError("Cannot change the owner's role");
      }

      await repo.updateMemberRole(projectId, targetUserId, input.role);

      logActivity(db, {
        userId: requesterId,
        projectId,
        action: "member:role_changed",
        targetType: "user",
        targetId: targetUserId,
        metadata: { newRole: input.role },
      });
    },

    async removeMember(
      projectId: string,
      requesterId: string,
      targetUserId: string,
    ) {
      await assertOwner(repo, projectId, requesterId);

      if (requesterId === targetUserId) {
        throw new ValidationError("You cannot remove yourself from the project");
      }

      const target = await repo.findMember(projectId, targetUserId);
      if (target === null) {
        throw new NotFoundError("Member", targetUserId);
      }
      if (target.role === "owner") {
        throw new ValidationError("Cannot remove the project owner");
      }

      await repo.removeMember(projectId, targetUserId);

      logActivity(db, {
        userId: requesterId,
        projectId,
        action: "member:left",
        targetType: "user",
        targetId: targetUserId,
        metadata: { removedBy: requesterId },
      });
    },
  };
}

export type ProjectsService = ReturnType<typeof createProjectsService>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function assertOwner(
  repo: ProjectsRepository,
  projectId: string,
  userId: string,
): Promise<void> {
  const project = await repo.findProjectById(projectId);
  if (project === null) throw new NotFoundError("Project", projectId);
  if (project.ownerId !== userId) throw new ForbiddenError("Only the project owner can do this");
}

function serializeProject(p: {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    ownerId: p.ownerId,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function serializeProjectRow(p: {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  role: string;
}) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    ownerId: p.ownerId,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    role: p.role,
  };
}

function serializeMember(m: {
  projectId: string;
  userId: string;
  role: string;
  createdAt: Date;
  username: string;
  avatarUrl: string | null;
  email: string;
}) {
  return {
    projectId: m.projectId,
    userId: m.userId,
    role: m.role,
    username: m.username,
    avatarUrl: m.avatarUrl,
    joinedAt: m.createdAt.toISOString(),
  };
}
