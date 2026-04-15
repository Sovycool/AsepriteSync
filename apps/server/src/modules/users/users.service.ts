import { ConflictError, NotFoundError } from "../../errors/index.js";
import type { UsersRepository } from "./users.repository.js";
import type { UpdateProfileInput } from "./users.schema.js";

export function createUsersService(repo: UsersRepository) {
  return {
    async getMe(userId: string) {
      const user = await repo.findById(userId);
      if (user === null) throw new NotFoundError("User", userId);
      return serializeUser(user);
    },

    async updateMe(userId: string, input: UpdateProfileInput) {
      if (input.username !== undefined) {
        const existing = await repo.findByUsername(input.username);
        if (existing !== null && existing.id !== userId) {
          throw new ConflictError("Username already taken");
        }
      }

      const updated = await repo.updateProfile(userId, {
        ...(input.username !== undefined && { username: input.username }),
        ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
      });

      if (updated === null) throw new NotFoundError("User", userId);
      return serializeUser(updated);
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;

function serializeUser(u: {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    avatarUrl: u.avatarUrl,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}
