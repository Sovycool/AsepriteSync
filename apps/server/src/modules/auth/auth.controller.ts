import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { ValidationError } from "../../errors/index.js";
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_MAX_AGE } from "../../lib/jwt.js";
import { ok } from "../../lib/response.js";
import type { AuthService } from "./auth.service.js";
import {
  registerSchema,
  loginSchema,
  requestResetSchema,
  applyResetSchema,
} from "./auth.schema.js";

function parseBody<T>(schema: { parse: (v: unknown) => T }, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ValidationError("Validation failed", {
        fields: error.flatten().fieldErrors,
      });
    }
    throw error;
  }
}

function setRefreshCookie(reply: FastifyReply, token: string): void {
  void reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env["NODE_ENV"] === "production",
    maxAge: REFRESH_COOKIE_MAX_AGE,
    path: "/auth",
  });
}

export function createAuthController(service: AuthService) {
  return {
    async register(request: FastifyRequest, reply: FastifyReply) {
      const input = parseBody(registerSchema, request.body);
      const result = await service.register(input);

      setRefreshCookie(reply, result.refreshToken);

      return reply.status(201).send(
        ok({
          user: result.user,
          accessToken: result.accessToken,
        }),
      );
    },

    async login(request: FastifyRequest, reply: FastifyReply) {
      const input = parseBody(loginSchema, request.body);
      const result = await service.login(input);

      setRefreshCookie(reply, result.refreshToken);

      return reply.send(
        ok({
          user: result.user,
          accessToken: result.accessToken,
        }),
      );
    },

    async refresh(request: FastifyRequest, reply: FastifyReply) {
      const token = request.cookies[REFRESH_COOKIE_NAME];
      if (!token) {
        return reply.status(401).send({
          data: null,
          error: { code: "UNAUTHORIZED", message: "Refresh token missing" },
        });
      }

      const result = await service.refresh(token);

      setRefreshCookie(reply, result.refreshToken);

      return reply.send(ok({ accessToken: result.accessToken, user: result.user }));
    },

    async requestReset(request: FastifyRequest, reply: FastifyReply) {
      const input = parseBody(requestResetSchema, request.body);
      const baseUrl =
        request.headers.origin ??
        `${request.protocol}://${request.hostname}`;

      await service.requestPasswordReset(input, baseUrl);

      // Always 200 — don't leak whether the email exists
      return reply.send(
        ok({ message: "If this email is registered, a reset link has been sent." }),
      );
    },

    async applyReset(request: FastifyRequest, reply: FastifyReply) {
      const { token } = request.params as { token: string };
      const input = parseBody(applyResetSchema, request.body);

      await service.applyPasswordReset(token, input);

      return reply.send(ok({ message: "Password reset successfully." }));
    },
  };
}

export type AuthController = ReturnType<typeof createAuthController>;
