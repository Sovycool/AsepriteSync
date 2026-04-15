import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../../errors/index.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/jwt.js";
import { sendMail, buildPasswordResetEmail } from "../../lib/mailer.js";
import type { AuthRepository } from "./auth.repository.js";
import type { RegisterInput, LoginInput, RequestResetInput, ApplyResetInput } from "./auth.schema.js";

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export function createAuthService(repo: AuthRepository) {
  return {
    async register(input: RegisterInput) {
      const existingEmail = await repo.findUserByEmail(input.email);
      if (existingEmail !== null) {
        throw new ConflictError("Email already registered");
      }

      const existingUsername = await repo.findUserByUsername(input.username);
      if (existingUsername !== null) {
        throw new ConflictError("Username already taken");
      }

      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
      const id = crypto.randomUUID();

      const user = await repo.createUser({
        id,
        email: input.email,
        username: input.username,
        passwordHash,
      });

      const accessToken = signAccessToken(user.id);
      const refreshToken = signRefreshToken(user.id);

      return {
        user: sanitizeUser(user),
        accessToken,
        refreshToken,
      };
    },

    async login(input: LoginInput) {
      const user = await repo.findUserByEmail(input.email);
      if (user === null) {
        // Constant-time rejection — don't reveal whether email exists
        await bcrypt.hash(input.password, BCRYPT_ROUNDS);
        throw new UnauthorizedError("Invalid email or password");
      }

      const passwordValid = await bcrypt.compare(input.password, user.passwordHash);
      if (!passwordValid) {
        throw new UnauthorizedError("Invalid email or password");
      }

      const accessToken = signAccessToken(user.id);
      const refreshToken = signRefreshToken(user.id);

      return {
        user: sanitizeUser(user),
        accessToken,
        refreshToken,
      };
    },

    async refresh(refreshToken: string) {
      const payload = verifyRefreshToken(refreshToken);

      const user = await repo.findUserById(payload.userId);
      if (user === null) {
        throw new UnauthorizedError("User not found");
      }

      const newAccessToken = signAccessToken(user.id);
      const newRefreshToken = signRefreshToken(user.id);

      return { accessToken: newAccessToken, refreshToken: newRefreshToken, user: sanitizeUser(user) };
    },

    async requestPasswordReset(input: RequestResetInput, baseUrl: string) {
      const user = await repo.findUserByEmail(input.email);

      // Always respond with success to prevent email enumeration
      if (user === null) return;

      // Delete previous tokens for this user
      await repo.deleteExpiredResetTokens(user.id);

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

      await repo.createResetToken({ token, userId: user.id, expiresAt });

      const resetUrl = `${baseUrl}/reset-password?token=${token}`;
      const mail = buildPasswordResetEmail(user.username, resetUrl);
      await sendMail({ ...mail, to: user.email });
    },

    async applyPasswordReset(token: string, input: ApplyResetInput) {
      const resetRow = await repo.findValidResetToken(token);
      if (resetRow === null) {
        throw new ValidationError("Invalid or expired reset token");
      }

      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
      await repo.updatePassword(resetRow.userId, passwordHash);
      await repo.markResetTokenUsed(token);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

/** Strip sensitive fields before returning user data to clients. */
function sanitizeUser(user: {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
