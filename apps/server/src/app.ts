import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { db } from "@asepritesync/db";
import { config } from "./config.js";
import { AppError } from "./errors/index.js";
import { err } from "./lib/response.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { projectRoutes } from "./modules/projects/projects.routes.js";
import { usersRoutes } from "./modules/users/users.routes.js";
import { activityRoutes } from "./modules/activity/activity.routes.js";
import { fileRoutes } from "./modules/files/files.routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      config.NODE_ENV === "production"
        ? true
        : { transport: { target: "pino-pretty", options: { colorize: true } } },
  });

  // -------------------------------------------------------------------------
  // Plugins
  // -------------------------------------------------------------------------

  await app.register(cookie);

  await app.register(multipart, {
    limits: {
      fileSize: config.MAX_FILE_SIZE_MB * 1024 * 1024,
      files: 1,
    },
  });

  await app.register(cors, {
    origin: config.CORS_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  // Rate limiting — /auth/* gets a tighter limit (10 req/min per IP)
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.userId ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      data: null,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: `Too many requests — slow down. Retry after ${String(context.after)}.`,
      },
    }),
  });

  await app.register(swagger, {
    openapi: {
      info: { title: "AsepriteSync API", version: "1.0.0" },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });

  await app.register(swaggerUi, { routePrefix: "/docs" });

  // Decorate request with userId (undefined by default, set by authenticate)
  app.decorateRequest("userId", undefined);

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------

  // Auth routes with tighter rate limit
  await app.register(
    async (authApp) => {
      await authApp.register(rateLimit, {
        max: 10,
        timeWindow: "1 minute",
        keyGenerator: (req) => req.ip,
        errorResponseBuilder: (_req, context) => ({
          data: null,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: `Too many requests. Retry after ${String(context.after)}.`,
          },
        }),
      });
      await authApp.register(authRoutes, { db, prefix: "" });
    },
    { prefix: "/auth" },
  );

  await app.register(projectRoutes, { db });
  await app.register(fileRoutes, { db });
  await app.register(usersRoutes, { db });
  await app.register(activityRoutes, { db });

  app.get("/healthz", async () => ok({ status: "ok" }));

  // -------------------------------------------------------------------------
  // Error handler
  // -------------------------------------------------------------------------

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send(err(error.code, error.message, error.details));
    }

    // Fastify 422 validation errors (shouldn't happen since we use Zod, but
    // acts as a safety net if someone adds native Fastify schema validation)
    if ("validation" in error && error.statusCode === 400) {
      return reply.status(400).send(err("VALIDATION_ERROR", error.message));
    }

    // Unknown errors — log and return 500
    app.log.error(error);
    return reply.status(500).send(err("INTERNAL_SERVER_ERROR", "An unexpected error occurred"));
  });

  return app;
}

// Re-export ok helper so callers in this file don't need a separate import
function ok<T>(data: T) {
  return { data, error: null };
}
