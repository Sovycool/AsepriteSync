import type { Database } from "@asepritesync/db";
import { createFilesRepository } from "../modules/files/files.repository.js";
import { wsServer } from "../lib/ws-server.js";

const CLEANUP_INTERVAL_MS = 60_000; // 1 minute

/**
 * Starts a background job that clears expired file locks every minute.
 * For each cleared lock it broadcasts `file:unlocked` via WebSocket.
 * Returns a cleanup function that stops the interval (useful in tests).
 */
export function startLockCleanupJob(db: Database): () => void {
  const repo = createFilesRepository(db);

  const tick = async () => {
    try {
      const cleared = await repo.clearExpiredLocks();
      if (cleared.length > 0) {
        console.log(
          `[lock-cleanup] Cleared ${cleared.length.toString()} expired lock(s): ${cleared.map((r) => r.fileId).join(", ")}`,
        );
        for (const { fileId, projectId } of cleared) {
          wsServer.broadcast(projectId, "file:unlocked", { fileId });
        }
      }
    } catch (err) {
      console.error("[lock-cleanup] Failed to clear expired locks:", err);
    }
  };

  const handle = setInterval(() => void tick(), CLEANUP_INTERVAL_MS);

  // Allow Node.js to exit even if the interval is still running
  handle.unref();

  return () => { clearInterval(handle); };
}
