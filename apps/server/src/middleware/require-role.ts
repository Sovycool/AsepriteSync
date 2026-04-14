import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserRole } from "@asepritesync/shared";
import { ROLE_HIERARCHY } from "@asepritesync/shared";
import { ForbiddenError, UnauthorizedError } from "../errors/index.js";

/**
 * Factory that creates a preHandler verifying the authenticated user has at least
 * one of the required roles in the given project.
 *
 * Expects:
 * - `request.userId` to be set (i.e. `authenticate` ran first)
 * - `request.params` to contain `{ id: string }` (the project id)
 * - A `getProjectRole` service injected via app decorator (added in T4)
 */
export function requireRole(allowedRoles: UserRole[]) {
  const minLevel = Math.min(
    ...allowedRoles.map((r) => ROLE_HIERARCHY[r]),
  );

  return async function roleGuard(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    if (!request.userId) {
      throw new UnauthorizedError();
    }

    const params = request.params as Record<string, string>;
    const projectId = params["id"] ?? params["projectId"];
    if (!projectId) {
      throw new ForbiddenError("Project id missing from route params");
    }

    // The actual role lookup is delegated to the `request.getProjectRole` decorator
    // injected by the projects plugin in T4. This keeps the middleware decoupled.
    const getRoleForProject = (
      request as FastifyRequest & {
        getProjectRole?: (projectId: string, userId: string) => Promise<UserRole | null>;
      }
    ).getProjectRole;

    if (!getRoleForProject) {
      // Middleware used before T4 sets it up — deny access
      throw new ForbiddenError("Role resolver not configured");
    }

    const role = await getRoleForProject(projectId, request.userId);
    if (role === null) {
      throw new ForbiddenError("Not a member of this project");
    }

    const userLevel = ROLE_HIERARCHY[role];
    if (userLevel < minLevel) {
      throw new ForbiddenError(
        `Requires role ${allowedRoles.join(" or ")}, got ${role}`,
      );
    }
  };
}
