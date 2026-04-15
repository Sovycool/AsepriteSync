import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictError, NotFoundError } from "../../../errors/index.js";
import { createUsersService } from "../users.service.js";
import type { UsersRepository } from "../users.repository.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2024-01-01T00:00:00.000Z");

function makeUser(overrides = {}) {
  return {
    id: "user-1",
    email: "alice@example.com",
    username: "alice",
    avatarUrl: null as string | null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeRepo(overrides: Partial<UsersRepository> = {}): UsersRepository {
  return {
    findById: vi.fn().mockResolvedValue(makeUser()),
    findByUsername: vi.fn().mockResolvedValue(null),
    updateProfile: vi.fn().mockResolvedValue(makeUser()),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UsersService", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // -------------------------------------------------------------------------
  describe("getMe", () => {
    it("throws NotFoundError when user does not exist", async () => {
      const repo = makeRepo({ findById: vi.fn().mockResolvedValue(null) });
      const service = createUsersService(repo);

      await expect(service.getMe("missing-id")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("returns serialized user when found", async () => {
      const repo = makeRepo();
      const service = createUsersService(repo);

      const result = await service.getMe("user-1");

      expect(repo.findById).toHaveBeenCalledWith("user-1");
      expect(result).toMatchObject({
        id: "user-1",
        email: "alice@example.com",
        username: "alice",
        avatarUrl: null,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("updateMe", () => {
    it("throws ConflictError when username is already taken by another user", async () => {
      const repo = makeRepo({
        findByUsername: vi.fn().mockResolvedValue(makeUser({ id: "other-user" })),
      });
      const service = createUsersService(repo);

      await expect(
        service.updateMe("user-1", { username: "alice" }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("allows user to keep their own username", async () => {
      // findByUsername returns the same user → no conflict
      const repo = makeRepo({
        findByUsername: vi.fn().mockResolvedValue(makeUser({ id: "user-1" })),
        updateProfile: vi.fn().mockResolvedValue(makeUser({ username: "alice" })),
      });
      const service = createUsersService(repo);

      const result = await service.updateMe("user-1", { username: "alice" });

      expect(repo.updateProfile).toHaveBeenCalledOnce();
      expect(result.username).toBe("alice");
    });

    it("throws NotFoundError when user disappears during update", async () => {
      const repo = makeRepo({
        updateProfile: vi.fn().mockResolvedValue(null),
      });
      const service = createUsersService(repo);

      await expect(
        service.updateMe("user-1", { username: "new-name" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("updates profile and returns serialized result", async () => {
      const updated = makeUser({ username: "bob", avatarUrl: "https://example.com/bob.png" });
      const repo = makeRepo({
        updateProfile: vi.fn().mockResolvedValue(updated),
      });
      const service = createUsersService(repo);

      const result = await service.updateMe("user-1", {
        username: "bob",
        avatarUrl: "https://example.com/bob.png",
      });

      expect(repo.updateProfile).toHaveBeenCalledWith("user-1", {
        username: "bob",
        avatarUrl: "https://example.com/bob.png",
      });
      expect(result.username).toBe("bob");
      expect(result.avatarUrl).toBe("https://example.com/bob.png");
    });

    it("skips username conflict check when username is not in input", async () => {
      const repo = makeRepo({
        updateProfile: vi.fn().mockResolvedValue(makeUser({ avatarUrl: "https://cdn/a.png" })),
      });
      const service = createUsersService(repo);

      await service.updateMe("user-1", { avatarUrl: "https://cdn/a.png" });

      expect(repo.findByUsername).not.toHaveBeenCalled();
      expect(repo.updateProfile).toHaveBeenCalledOnce();
    });
  });
});
