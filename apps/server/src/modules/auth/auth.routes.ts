import type { FastifyInstance } from "fastify";
import type { Database } from "@asepritesync/db";
import { createAuthRepository } from "./auth.repository.js";
import { createAuthService } from "./auth.service.js";
import { createAuthController } from "./auth.controller.js";

export async function authRoutes(app: FastifyInstance, options: { db: Database }) {
  const repo = createAuthRepository(options.db);
  const service = createAuthService(repo);
  const ctrl = createAuthController(service);

  app.post("/register", (req, reply) => ctrl.register(req, reply));
  app.post("/login", (req, reply) => ctrl.login(req, reply));
  app.post("/refresh", (req, reply) => ctrl.refresh(req, reply));
  app.post("/reset-password", (req, reply) => ctrl.requestReset(req, reply));
  app.post("/reset-password/:token", (req, reply) => ctrl.applyReset(req, reply));
}
