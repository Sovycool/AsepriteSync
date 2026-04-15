/**
 * Preview pipeline — generates a 256×256 PNG thumbnail and an animated GIF
 * for a given .aseprite file, using the Aseprite CLI and Sharp.
 *
 * Graceful degradation:
 *  - ASEPRITE_CLI not set   → skip silently, return null paths
 *  - CLI binary not found   → log warning, return null paths
 *  - CLI invocation fails   → log error, return null paths
 *  - sharp not available    → store thumbnail at native resolution
 */

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, rename, copyFile, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { config } from "../config.js";

const THUMB_MAX = 256;

export interface PreviewPaths {
  /** Storage-relative path for the 256×256 PNG thumbnail, or null on failure. */
  thumbPath: string | null;
  /** Storage-relative path for the animated GIF, or null on failure. */
  animPath: string | null;
}

/**
 * Generate PNG thumbnail + animated GIF previews for a stored Aseprite file.
 *
 * @param sourceStoragePath  Relative storage path of the .aseprite source file
 *                           (e.g. `projectId/fileId/1.aseprite`).
 * @param outputBase         Prefix for the output paths
 *                           (e.g. `projectId/fileId/v2`).
 */
export async function generatePreviews(
  sourceStoragePath: string,
  outputBase: string,
): Promise<PreviewPaths> {
  const cliPath = config.ASEPRITE_CLI;
  if (!cliPath) {
    return { thumbPath: null, animPath: null };
  }

  // Resolve absolute path of the source .aseprite file
  const sourcePath = path.resolve(config.STORAGE_PATH, sourceStoragePath);
  try {
    await access(sourcePath);
  } catch {
    console.warn(`[preview] Source file not found: ${sourcePath}`);
    return { thumbPath: null, animPath: null };
  }

  const storageBase = path.resolve(config.STORAGE_PATH);
  const thumbStoragePath = `${outputBase}_thumb.png`;
  const animStoragePath = `${outputBase}_anim.gif`;
  const thumbAbsPath = path.join(storageBase, thumbStoragePath);
  const animAbsPath = path.join(storageBase, animStoragePath);

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "asepritesync-preview-"));

  try {
    const tmpThumb = path.join(tmpDir, "thumb.png");
    const tmpAnim = path.join(tmpDir, "anim.gif");

    // -----------------------------------------------------------------
    // Generate PNG thumbnail (first frame only)
    // -----------------------------------------------------------------
    await runCli(cliPath, [
      "--batch", sourcePath,
      "--frame-range", "0,0",
      "--save-as", tmpThumb,
    ]);

    // Resize to max THUMB_MAX × THUMB_MAX, preserving aspect ratio
    await resizePng(tmpThumb, THUMB_MAX);

    // Move to storage location
    await ensureParentDir(thumbAbsPath);
    await copyFile(tmpThumb, thumbAbsPath);

    // -----------------------------------------------------------------
    // Generate animated GIF (all frames)
    // -----------------------------------------------------------------
    await runCli(cliPath, [
      "--batch", sourcePath,
      "--save-as", tmpAnim,
    ]);

    await ensureParentDir(animAbsPath);
    await copyFile(tmpAnim, animAbsPath);

    return { thumbPath: thumbStoragePath, animPath: animStoragePath };
  } catch (err) {
    console.error("[preview] Generation failed:", err instanceof Error ? err.message : err);
    return { thumbPath: null, animPath: null };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runCli(cliPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cliPath, args, { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("error", (err) => { reject(err); });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`aseprite exited ${code ?? "null"}: ${stderr.trim()}`));
      }
    });
  });
}

async function resizePng(filePath: string, maxSide: number): Promise<void> {
  try {
    // Dynamic import so the app boots even if sharp is somehow unavailable
    const sharp = (await import("sharp")).default;
    const tmpOut = filePath + ".tmp";
    await sharp(filePath)
      .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: false })
      .png({ compressionLevel: 7 })
      .toFile(tmpOut);
    await rename(tmpOut, filePath);
  } catch (err) {
    // Non-fatal — store at native resolution if sharp fails
    console.warn("[preview] sharp resize failed, storing at native size:", err instanceof Error ? err.message : err);
  }
}

async function ensureParentDir(filePath: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(filePath), { recursive: true });
}
