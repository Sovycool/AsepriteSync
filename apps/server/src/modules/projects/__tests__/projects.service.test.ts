import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
} from "../../../errors/index.js";
import { createProjectsService } from "../projects.service.js";
import type { ProjectsRepository } from "../projects.repository.js";
import type { Database } from "@asepritesync/db";

const mockDb = {
  insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ catch: vi.fn() }) }),
} as unknown as Database;

const NOW = new Date("2024-01-01T00:00:00.000Z");

function makeProject(overrides = {}) {
  return {
    id: "proj-1",
    name: "Test Project",
    description: null,
    ownerId: "user-1",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeRepo(overrides: Partial<ProjectsRepository> = {}): ProjectsRepository {
  return {
    listUserProjects: vi.fn().mockResolvedValue([]),
    findProjectById: vi.fn().mockResolvedValue(makeProject()),
    getMemberCount: vi.fn().mockResolvedValue(1),
    createProject: vi.fn().mockImplementation(async (input) => ({
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      ownerId: input.ownerId,
      createdAt: NOW,
      updatedAt: NOW,
    })),
    updateProject: vi.fn().mockImplementation(async (_id, input) => ({
      ...makeProject(),
      ...input,
    })),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    findMemberRole: vi.fn().mockResolvedValue(null),
    listMembers: vi.fn().mockResolvedValue([]),
    findMember: vi.fn().mockResolvedValue(null),
    addMember: vi.fn().mockResolvedValue(null),
    updateMemberRole: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("ProjectsService", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // -------------------------------------------------------------------------
  describe("createProject", () => {
    it("creates a project and returns it with role=owner", async () => {
      const repo = makeRepo();
      const service = createProjectsService(repo, mockDb);

      const result = await service.createProject("user-1", { name: "My Project" });

      expect(result.name).toBe("My Project");
      expect(result.role).toBe("owner");
      expect(repo.createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: "My Project", ownerId: "user-1" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("getProject", () => {
    it("throws ForbiddenError when user is not a member", async () => {
      const repo = makeRepo({ findMemberRole: vi.fn().mockResolvedValue(null) });
      const service = createProjectsService(repo, mockDb);

      await expect(service.getProject("proj-1", "user-99")).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("throws NotFoundError for unknown project", async () => {
      const repo = makeRepo({ findProjectById: vi.fn().mockResolvedValue(null) });
      const service = createProjectsService(repo, mockDb);

      await expect(service.getProject("proj-99", "user-1")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("returns project with member role", async () => {
      const repo = makeRepo({
        findMemberRole: vi.fn().mockResolvedValue("editor"),
        getMemberCount: vi.fn().mockResolvedValue(3),
      });
      const service = createProjectsService(repo, mockDb);

      const result = await service.getProject("proj-1", "user-2");
      expect(result.role).toBe("editor");
      expect(result.memberCount).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  describe("updateProject", () => {
    it("throws ForbiddenError when requester is not the owner", async () => {
      const repo = makeRepo({
        findProjectById: vi.fn().mockResolvedValue(makeProject({ ownerId: "user-1" })),
      });
      const service = createProjectsService(repo, mockDb);

      await expect(
        service.updateProject("proj-1", "user-2", { name: "Renamed" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // -------------------------------------------------------------------------
  describe("inviteMember", () => {
    it("throws NotFoundError when invitee email does not exist", async () => {
      const repo = makeRepo({
        findMemberRole: vi.fn().mockResolvedValue("owner"),
        findUserByEmail: vi.fn().mockResolvedValue(null),
      });
      const service = createProjectsService(repo, mockDb);

      await expect(
        service.inviteMember("proj-1", "user-1", { email: "ghost@ex.com", role: "editor" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws ConflictError when user is already a member", async () => {
      const repo = makeRepo({
        findMemberRole: vi.fn().mockResolvedValue("owner"),
        findUserByEmail: vi.fn().mockResolvedValue({ id: "user-2", username: "bob", avatarUrl: null }),
        findMember: vi.fn().mockResolvedValue({ role: "editor" }),
      });
      const service = createProjectsService(repo, mockDb);

      await expect(
        service.inviteMember("proj-1", "user-1", { email: "bob@ex.com", role: "editor" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("throws ForbiddenError when viewer tries to invite", async () => {
      const repo = makeRepo({
        findMemberRole: vi.fn().mockResolvedValue("viewer"),
      });
      const service = createProjectsService(repo, mockDb);

      await expect(
        service.inviteMember("proj-1", "user-1", { email: "someone@ex.com", role: "editor" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // -------------------------------------------------------------------------
  describe("removeMember", () => {
    it("throws ValidationError when owner tries to remove themselves", async () => {
      const repo = makeRepo({
        findProjectById: vi.fn().mockResolvedValue(makeProject({ ownerId: "user-1" })),
      });
      const service = createProjectsService(repo, mockDb);

      await expect(
        service.removeMember("proj-1", "user-1", "user-1"),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("throws ValidationError when trying to remove the owner", async () => {
      const repo = makeRepo({
        findProjectById: vi.fn().mockResolvedValue(makeProject({ ownerId: "user-1" })),
        findMember: vi.fn().mockResolvedValue({ role: "owner" }),
      });
      const service = createProjectsService(repo, mockDb);

      await expect(
        service.removeMember("proj-1", "user-1", "user-2"),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
