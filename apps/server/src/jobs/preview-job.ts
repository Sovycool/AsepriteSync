/**
 * Background preview-generation job.
 *
 * Called fire-and-forget after every upload or version update.
 * On success, updates `file_versions.preview_path` and broadcasts
 * a WebSocket notification to the project room.
 */

import path from "node:path";
import type { Database } from "@asepritesync/db";
import { generatePreviews } from "../lib/preview.js";
import type { FilesRepository } from "../modules/files/files.repository.js";

export interface PreviewJobParams {
  db: Database;
  repo: FilesRepository;
  projectId: string;
  fileId: string;
  versionId: string;
  storagePath: string;
}

/**
 * Enqueue a preview-generation pass in the background.
 * Returns immediately; all work happens asynchronously.
 */
export function enqueuePreviewJob(params: PreviewJobParams): void {
  // Use setImmediate so the HTTP response is sent before we start heavy I/O
  setImmediate(() => {
    void runPreviewJob(params).catch((err: unknown) => {
      console.error("[preview-job] Unhandled error:", err);
    });
  });
}

async function runPreviewJob({
  repo,
  projectId,
  fileId,
  versionId,
  storagePath,
}: PreviewJobParams): Promise<void> {
  // Derive output base from the source storage path (strip extension)
  const ext = path.extname(storagePath);
  const outputBase = storagePath.slice(0, storagePath.length - ext.length);

  const { thumbPath } = await generatePreviews(storagePath, outputBase);

  if (thumbPath !== null) {
    await repo.updateVersionPreviewPath(versionId, thumbPath);
    console.log(`[preview-job] Preview stored for version ${versionId}: ${thumbPath}`);
  }
}
