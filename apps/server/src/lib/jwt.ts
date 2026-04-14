import jwt, { type SignOptions } from "jsonwebtoken";
import { config } from "../config.js";
import { UnauthorizedError } from "../errors/index.js";

export interface AccessTokenPayload {
  userId: string;
  type: "access";
}

export interface RefreshTokenPayload {
  userId: string;
  type: "refresh";
}

/** Sign an access token (15 min by default). */
export function signAccessToken(userId: string): string {
  const opts: SignOptions = {
    expiresIn: config.JWT_ACCESS_EXPIRY as NonNullable<SignOptions["expiresIn"]>,
    algorithm: "HS256",
  };
  return jwt.sign({ userId, type: "access" } satisfies AccessTokenPayload, config.JWT_SECRET, opts);
}

/** Sign a refresh token (7 days by default). */
export function signRefreshToken(userId: string): string {
  const opts: SignOptions = {
    expiresIn: config.JWT_REFRESH_EXPIRY as NonNullable<SignOptions["expiresIn"]>,
    algorithm: "HS256",
  };
  return jwt.sign(
    { userId, type: "refresh" } satisfies RefreshTokenPayload,
    config.JWT_SECRET,
    opts,
  );
}

/** Verify and return an access token payload. Throws UnauthorizedError on failure. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("userId" in payload) ||
      !("type" in payload) ||
      payload.type !== "access"
    ) {
      throw new UnauthorizedError("Invalid token payload");
    }
    return payload as AccessTokenPayload;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw new UnauthorizedError("Invalid or expired token");
  }
}

/** Verify and return a refresh token payload. Throws UnauthorizedError on failure. */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ["HS256"] });
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("userId" in payload) ||
      !("type" in payload) ||
      payload.type !== "refresh"
    ) {
      throw new UnauthorizedError("Invalid token payload");
    }
    return payload as RefreshTokenPayload;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw new UnauthorizedError("Invalid or expired refresh token");
  }
}

export const REFRESH_COOKIE_NAME = "refresh_token";

/** Max-age in seconds for the refresh token cookie (7 days). */
export const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;
