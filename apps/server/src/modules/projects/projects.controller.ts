import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { ValidationError, UnauthorizedError } from "../../errors/index.js";
import { ok } from "../../lib/response.js";
import type { ProjectsService } from "./projects.service.js";
import {
  createProjectSchema,
  updateProjectSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
  listQuerySchema,
} from "./projects.schema.js";

function parse<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ValidationError("Validation failed", {
        fields: error.flatten().fieldErrors,
      });
    }
    throw error;
  }
}

function requireUserId(request: FastifyRequest): string {
  if (!request.userId) throw new UnauthorizedError();
  return request.userId;
}

export function createProjectsController(service: ProjectsService) {
  return {
    async list(request: FastifyRequest, reply: FastifyReply) {
      const userId = requireUserId(request);
      const query = parse(listQuerySchema, request.query);
      const result = await service.listUserProjects(userId, query);
      return reply.send(ok(result.projects, result.meta));
    },

    async get(request: FastifyRequest, reply: FastifyReply) {
      const userId = requireUserId(request);
      const { id } = request.params as { id: string };
      const project = await service.getProject(id, userId);
      return reply.send(ok(project));
    },

    async create(request: FastifyRequest, reply: FastifyReply) {
      const userId = requireUserId(request);
      const input = parse(createProjectSchema, request.body);
      const project = await service.createProject(userId, input);
      return reply.status(201).send(ok(project));
    },

    async update(request: FastifyRequest, reply: FastifyReply) {
      const userId = requireUserId(request);
      const { id } = request.params as { id: string };
      const input = parse(updateProjectSchema, request.body);
      const project = await service.updateProject(id, userId, input);
      return reply.send(ok(project));
    },

    async remove(request: FastifyRequest, reply: FastifyReply) {
      const userId = requireUserId(request);
      const { id } = request.params as { id: string };
      await service.deleteProject(id, userId);
      return reply.send(ok({ message: "Project deleted" }));
    },

    // Members
    async listMembers(request: FastifyRequest, reply: FastifyReply) {
      const userId = requireUserId(request);
      const { id } = request.params as { id: string };
      const members = await service.listMembers(id, userId);
      return reply.send(ok(members));
    },

    async inviteMember(request: FastifyRequest, reply: FastifyReply) {
      const userId = requireUserId(request);
      const { id } = request.params as { id: string };
      const input = parse(inviteMemberSchema, request.body);
      const member = await service.inviteMember(id, userId, input);
      return reply.status(201).send(ok(member));
    },

    async updateMemberRole(request: FastifyRequest, reply: FastifyReply) {
      const userId = requireUserId(request);
      const { id, uid } = request.params as { id: string; uid: string };
      const input = parse(updateMemberRoleSchema, request.body);
      await service.updateMemberRole(id, userId, uid, input);
      return reply.send(ok({ message: "Role updated" }));
    },

    async removeMember(request: FastifyRequest, reply: FastifyReply) {
      const userId = requireUserId(request);
      const { id, uid } = request.params as { id: string; uid: string };
      await service.removeMember(id, userId, uid);
      return reply.send(ok({ message: "Member removed" }));
    },
  };
}

export type ProjectsController = ReturnType<typeof createProjectsController>;
