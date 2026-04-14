import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "../lib/jwt.js";
import { UnauthorizedError } from "../errors/index.js";

/**
 * Fastify preHandler that verifies the Bearer JWT and injects `request.userId`.
 * Add it to protected routes: `{ preHandler: [authenticate] }`.
 */
export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or malformed Authorization header");
  }

  const token = authHeader.slice(7);
  const payload = verifyAccessToken(token);
  request.userId = payload.userId;
}
