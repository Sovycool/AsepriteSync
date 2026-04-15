import { eq } from "drizzle-orm";
import type { Database } from "@asepritesync/db";
import { users } from "@asepritesync/db";

export function createUsersRepository(db: Database) {
  return {
    async findById(id: string) {
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          username: users.username,
          avatarUrl: users.avatarUrl,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return user ?? null;
    },

    async findByUsername(username: string) {
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);
      return user ?? null;
    },

    async updateProfile(id: string, input: { username?: string; avatarUrl?: string | null }) {
      const [updated] = await db
        .update(users)
        .set({
          ...(input.username !== undefined && { username: input.username }),
          ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning({
          id: users.id,
          email: users.email,
          username: users.username,
          avatarUrl: users.avatarUrl,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        });
      return updated ?? null;
    },
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
