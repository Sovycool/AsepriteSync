import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { Database } from "@asepritesync/db";
import { authenticate } from "../../middleware/authenticate.js";
import { UnauthorizedError, ValidationError } from "../../errors/index.js";
import { ok } from "../../lib/response.js";
import { createUsersRepository } from "./users.repository.js";
import { createUsersService } from "./users.service.js";
import { updateProfileSchema } from "./users.schema.js";

export async function usersRoutes(app: FastifyInstance, options: { db: Database }) {
  const repo = createUsersRepository(options.db);
  const service = createUsersService(repo);

  app.addHook("preHandler", authenticate);

  app.get("/users/me", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.userId) throw new UnauthorizedError();
    const user = await service.getMe(request.userId);
    return reply.send(ok(user));
  });

  app.put("/users/me", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.userId) throw new UnauthorizedError();
    try {
      const input = updateProfileSchema.parse(request.body);
      const user = await service.updateMe(request.userId, input);
      return reply.send(ok(user));
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError("Validation failed", {
          fields: error.flatten().fieldErrors,
        });
      }
      throw error;
    }
  });
}
