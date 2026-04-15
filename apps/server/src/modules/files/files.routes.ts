import type { FastifyInstance } from "fastify";
import type { Database } from "@asepritesync/db";
import { authenticate } from "../../middleware/authenticate.js";
import { createFilesRepository } from "./files.repository.js";
import { createFilesService } from "./files.service.js";
import { createFilesController } from "./files.controller.js";

export async function fileRoutes(app: FastifyInstance, options: { db: Database }) {
  const repo = createFilesRepository(options.db);
  const service = createFilesService(repo, options.db);
  const ctrl = createFilesController(service);

  app.addHook("preHandler", authenticate);

  // Project-scoped file routes
  app.get("/projects/:id/files", (req, reply) => ctrl.listProjectFiles(req, reply));
  app.post("/projects/:id/files", (req, reply) => ctrl.uploadFile(req, reply));

  // Static sub-routes registered BEFORE parameterised :id routes
  app.post("/files/batch-download", (req, reply) => ctrl.batchDownload(req, reply));

  // File-level routes
  app.get("/files/:id", (req, reply) => ctrl.downloadFile(req, reply));
  app.put("/files/:id", (req, reply) => ctrl.updateFile(req, reply));
  app.delete("/files/:id", (req, reply) => ctrl.deleteFile(req, reply));

  // Version history & restore
  app.get("/files/:id/versions", (req, reply) => ctrl.listVersions(req, reply));
  app.post("/files/:id/versions/:v/restore", (req, reply) => ctrl.restoreVersion(req, reply));
}
