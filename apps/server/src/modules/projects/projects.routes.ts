import type { FastifyInstance } from "fastify";
import type { Database } from "@asepritesync/db";
import { authenticate } from "../../middleware/authenticate.js";
import { createProjectsRepository } from "./projects.repository.js";
import { createProjectsService } from "./projects.service.js";
import { createProjectsController } from "./projects.controller.js";

export async function projectRoutes(
  app: FastifyInstance,
  options: { db: Database },
) {
  const repo = createProjectsRepository(options.db);
  const service = createProjectsService(repo, options.db);
  const ctrl = createProjectsController(service);

  // All project routes require authentication
  app.addHook("preHandler", authenticate);

  // -----------------------------------------------------------------------
  // /projects
  // -----------------------------------------------------------------------
  app.get("/projects", (req, reply) => ctrl.list(req, reply));
  app.post("/projects", (req, reply) => ctrl.create(req, reply));

  app.get("/projects/:id", (req, reply) => ctrl.get(req, reply));
  app.put("/projects/:id", (req, reply) => ctrl.update(req, reply));
  app.delete("/projects/:id", (req, reply) => ctrl.remove(req, reply));

  // -----------------------------------------------------------------------
  // /projects/:id/members
  // -----------------------------------------------------------------------
  app.get("/projects/:id/members", (req, reply) => ctrl.listMembers(req, reply));
  app.post("/projects/:id/members", (req, reply) => ctrl.inviteMember(req, reply));
  app.put("/projects/:id/members/:uid", (req, reply) => ctrl.updateMemberRole(req, reply));
  app.delete("/projects/:id/members/:uid", (req, reply) => ctrl.removeMember(req, reply));
}
