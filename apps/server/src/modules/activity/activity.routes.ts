import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { desc, eq, lt, and, inArray } from "drizzle-orm";
import type { Database } from "@asepritesync/db";
import { activityLogs, projectMembers } from "@asepritesync/db";
import { authenticate } from "../../middleware/authenticate.js";
import { UnauthorizedError } from "../../errors/index.js";
import { ok } from "../../lib/response.js";
import { decodeCursor, encodeCursor } from "../../lib/pagination.js";

const DEFAULT_LIMIT = 30;

export async function activityRoutes(app: FastifyInstance, options: { db: Database }) {
  const { db } = options;

  app.addHook("preHandler", authenticate);

  app.get("/activity", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.userId) throw new UnauthorizedError();

    const query = request.query as { cursor?: string; limit?: string };
    const limit = Math.min(Number(query.limit ?? DEFAULT_LIMIT), 100);
    const cursor = query.cursor;

    // Get the user's project memberships
    const memberships = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, request.userId));

    if (memberships.length === 0) {
      return reply.send(ok([], { cursor: null, hasMore: false }));
    }

    const projectIds = memberships.map((m) => m.projectId);

    const conditions = [inArray(activityLogs.projectId, projectIds)];
    if (cursor !== undefined) {
      conditions.push(lt(activityLogs.createdAt, decodeCursor(cursor)));
    }

    const rows = await db
      .select()
      .from(activityLogs)
      .where(and(...conditions))
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);

    const serialized = items.map((row) => ({
      id: row.id,
      userId: row.userId,
      projectId: row.projectId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    }));

    return reply.send(
      ok(serialized, {
        cursor: last !== undefined ? encodeCursor(last.createdAt) : null,
        hasMore,
      }),
    );
  });
}
