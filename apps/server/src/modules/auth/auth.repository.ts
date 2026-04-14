import { eq, and, gt } from "drizzle-orm";
import type { Database } from "@asepritesync/db";
import { users, passwordResetTokens } from "@asepritesync/db";

export interface CreateUserInput {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
}

export interface CreateResetTokenInput {
  token: string;
  userId: string;
  expiresAt: Date;
}

export function createAuthRepository(db: Database) {
  return {
    async findUserByEmail(email: string) {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return user ?? null;
    },

    async findUserByUsername(username: string) {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);
      return user ?? null;
    },

    async findUserById(id: string) {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return user ?? null;
    },

    async createUser(input: CreateUserInput) {
      const [user] = await db.insert(users).values(input).returning();
      if (!user) throw new Error("Failed to create user");
      return user;
    },

    async updatePassword(userId: string, passwordHash: string) {
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, userId));
    },

    async createResetToken(input: CreateResetTokenInput) {
      await db.insert(passwordResetTokens).values(input);
    },

    async findValidResetToken(token: string) {
      const [row] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.token, token),
            gt(passwordResetTokens.expiresAt, new Date()),
            // usedAt IS NULL
            eq(passwordResetTokens.usedAt, null as unknown as Date),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async markResetTokenUsed(token: string) {
      await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.token, token));
    },

    async deleteExpiredResetTokens(userId: string) {
      // Clean up old tokens for this user on new reset request
      await db
        .delete(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, userId));
    },
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
