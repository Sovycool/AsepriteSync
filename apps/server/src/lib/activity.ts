import type { Database } from "@asepritesync/db";
import { activityLogs } from "@asepritesync/db";
import type { ActivityAction } from "@asepritesync/shared";
import crypto from "node:crypto";

export interface LogActivityInput {
  userId: string;
  projectId: string;
  action: ActivityAction;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget activity logger.
 * Never throws — logging failures must not break the main operation.
 */
export function logActivity(db: Database, input: LogActivityInput): void {
  db.insert(activityLogs)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      projectId: input.projectId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata ?? null,
    })
    .catch((err: unknown) => {
      console.error("[activity] Failed to log activity:", err);
    });
}
