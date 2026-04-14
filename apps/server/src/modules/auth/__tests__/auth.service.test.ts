import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictError, UnauthorizedError, ValidationError } from "../../../errors/index.js";
import { createAuthService } from "../auth.service.js";
import type { AuthRepository } from "../auth.repository.js";

// Minimal in-memory repo for unit tests
function makeRepo(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    findUserByEmail: vi.fn().mockResolvedValue(null),
    findUserByUsername: vi.fn().mockResolvedValue(null),
    findUserById: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockImplementation(
      async (input: { id: string; email: string; username: string; passwordHash: string }) => ({
        ...input,
        avatarUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    createResetToken: vi.fn().mockResolvedValue(undefined),
    findValidResetToken: vi.fn().mockResolvedValue(null),
    markResetTokenUsed: vi.fn().mockResolvedValue(undefined),
    deleteExpiredResetTokens: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("AuthService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("register", () => {
    it("creates a user and returns tokens", async () => {
      const repo = makeRepo();
      const service = createAuthService(repo);

      const result = await service.register({
        email: "alice@example.com",
        username: "alice",
        password: "securepassword",
      });

      expect(result.user.email).toBe("alice@example.com");
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(repo.createUser).toHaveBeenCalledOnce();
    });

    it("throws ConflictError when email already exists", async () => {
      const repo = makeRepo({
        findUserByEmail: vi.fn().mockResolvedValue({ id: "existing" }),
      });
      const service = createAuthService(repo);

      await expect(
        service.register({
          email: "alice@example.com",
          username: "alice",
          password: "securepassword",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("throws ConflictError when username already exists", async () => {
      const repo = makeRepo({
        findUserByEmail: vi.fn().mockResolvedValue(null),
        findUserByUsername: vi.fn().mockResolvedValue({ id: "existing" }),
      });
      const service = createAuthService(repo);

      await expect(
        service.register({
          email: "new@example.com",
          username: "alice",
          password: "securepassword",
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("login", () => {
    it("returns tokens for valid credentials", async () => {
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("correctpassword", 12);

      const repo = makeRepo({
        findUserByEmail: vi.fn().mockResolvedValue({
          id: "user-1",
          email: "alice@example.com",
          username: "alice",
          passwordHash: hash,
          avatarUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      });
      const service = createAuthService(repo);

      const result = await service.login({
        email: "alice@example.com",
        password: "correctpassword",
      });

      expect(result.user.email).toBe("alice@example.com");
      expect(result.accessToken).toBeTruthy();
    });

    it("throws UnauthorizedError for unknown email", async () => {
      const repo = makeRepo({ findUserByEmail: vi.fn().mockResolvedValue(null) });
      const service = createAuthService(repo);

      await expect(
        service.login({ email: "ghost@example.com", password: "anything" }),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("throws UnauthorizedError for wrong password", async () => {
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("correctpassword", 12);

      const repo = makeRepo({
        findUserByEmail: vi.fn().mockResolvedValue({
          id: "user-1",
          email: "alice@example.com",
          username: "alice",
          passwordHash: hash,
          avatarUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      });
      const service = createAuthService(repo);

      await expect(
        service.login({ email: "alice@example.com", password: "wrongpassword" }),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });

  describe("applyPasswordReset", () => {
    it("throws ValidationError for invalid or expired token", async () => {
      const repo = makeRepo({
        findValidResetToken: vi.fn().mockResolvedValue(null),
      });
      const service = createAuthService(repo);

      await expect(
        service.applyPasswordReset("bad-token", { password: "newpassword123" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("updates password and marks token used for valid token", async () => {
      const repo = makeRepo({
        findValidResetToken: vi.fn().mockResolvedValue({
          token: "valid-token",
          userId: "user-1",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
          createdAt: new Date(),
        }),
      });
      const service = createAuthService(repo);

      await service.applyPasswordReset("valid-token", { password: "newpassword123" });

      expect(repo.updatePassword).toHaveBeenCalledWith("user-1", expect.any(String));
      expect(repo.markResetTokenUsed).toHaveBeenCalledWith("valid-token");
    });
  });
});
