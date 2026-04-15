import type { FastifyReply, FastifyRequest } from "fastify";
import archiver from "archiver";
import { ZodError } from "zod";
import { UnauthorizedError, ValidationError } from "../../errors/index.js";
import { ok } from "../../lib/response.js";
import { storage } from "../../lib/storage.js";
import type { FilesService } from "./files.service.js";
import { listFilesQuerySchema, batchDownloadSchema } from "./files.schema.js";

export function createFilesController(service: FilesService) {
  return {
    async listProjectFiles(request: FastifyRequest, reply: FastifyReply) {
      if (!request.userId) throw new UnauthorizedError();
      const { id: projectId } = request.params as { id: string };

      let query;
      try {
        query = listFilesQuerySchema.parse(request.query);
      } catch (e) {
        if (e instanceof ZodError) {
          throw new ValidationError("Invalid query params", {
            fields: e.flatten().fieldErrors,
          });
        }
        throw e;
      }

      const result = await service.listProjectFiles(projectId, request.userId, query);
      return reply.send(ok(result.files, result.meta));
    },

    async uploadFile(request: FastifyRequest, reply: FastifyReply) {
      if (!request.userId) throw new UnauthorizedError();
      const { id: projectId } = request.params as { id: string };

      const data = await request.file();
      if (!data) {
        throw new ValidationError("No file provided in the request");
      }

      const result = await service.uploadFile(projectId, request.userId, {
        filename: data.filename,
        file: data.file,
      });

      return reply.status(201).send(ok(result));
    },

    async downloadFile(request: FastifyRequest, reply: FastifyReply) {
      if (!request.userId) throw new UnauthorizedError();
      const { id: fileId } = request.params as { id: string };

      const { filename, sizeBytes, stream } = await service.getFileStream(
        fileId,
        request.userId,
      );

      void reply.headers({
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": sizeBytes.toString(),
      });

      return reply.send(stream);
    },

    async deleteFile(request: FastifyRequest, reply: FastifyReply) {
      if (!request.userId) throw new UnauthorizedError();
      const { id: fileId } = request.params as { id: string };

      await service.deleteFile(fileId, request.userId);
      return reply.send(ok({ message: "File deleted" }));
    },

    async batchDownload(request: FastifyRequest, reply: FastifyReply) {
      if (!request.userId) throw new UnauthorizedError();

      let input;
      try {
        input = batchDownloadSchema.parse(request.body);
      } catch (e) {
        if (e instanceof ZodError) {
          throw new ValidationError("Validation failed", {
            fields: e.flatten().fieldErrors,
          });
        }
        throw e;
      }

      const entries = await service.getBatchStreams(request.userId, input);

      void reply.headers({
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="asepritesync-batch.zip"',
      });

      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.pipe(reply.raw);

      for (const entry of entries) {
        archive.append(storage.readStream(entry.storagePath), {
          name: entry.filename,
        });
      }

      await archive.finalize();
    },

    // ------------------------------------------------------------------
    // T6 — versioning handlers
    // ------------------------------------------------------------------

    async updateFile(request: FastifyRequest, reply: FastifyReply) {
      if (!request.userId) throw new UnauthorizedError();
      const { id: fileId } = request.params as { id: string };

      const data = await request.file();
      if (!data) throw new ValidationError("No file provided in the request");

      const result = await service.updateFile(fileId, request.userId, {
        filename: data.filename,
        file: data.file,
      });

      const status = result.isDuplicate ? 200 : 201;
      return reply.status(status).send(ok(result));
    },

    async listVersions(request: FastifyRequest, reply: FastifyReply) {
      if (!request.userId) throw new UnauthorizedError();
      const { id: fileId } = request.params as { id: string };

      let query;
      try {
        query = listFilesQuerySchema.parse(request.query);
      } catch (e) {
        if (e instanceof ZodError) {
          throw new ValidationError("Invalid query params", {
            fields: e.flatten().fieldErrors,
          });
        }
        throw e;
      }

      const result = await service.listVersions(fileId, request.userId, query);
      return reply.send(ok(result.versions, result.meta));
    },

    async restoreVersion(request: FastifyRequest, reply: FastifyReply) {
      if (!request.userId) throw new UnauthorizedError();
      const { id: fileId, v } = request.params as { id: string; v: string };

      const versionNumber = parseInt(v, 10);
      if (isNaN(versionNumber) || versionNumber < 1) {
        throw new ValidationError("Version number must be a positive integer");
      }

      const version = await service.restoreVersion(fileId, request.userId, versionNumber);
      return reply.status(201).send(ok(version));
    },
  };
}

export type FilesController = ReturnType<typeof createFilesController>;
