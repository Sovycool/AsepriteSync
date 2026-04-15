import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { Transform, type Readable } from "node:stream";
import { config } from "../config.js";

/**
 * Pipe a readable stream through a SHA-256 transform, writing to the given
 * absolute path. Returns the hex digest and total bytes written.
 */
async function saveWithHash(
  absolutePath: string,
  readable: Readable,
): Promise<{ hash: string; sizeBytes: number }> {
  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });

  const hashCtx = createHash("sha256");
  let sizeBytes = 0;

  const hashTransform = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hashCtx.update(chunk);
      sizeBytes += chunk.length;
      cb(null, chunk);
    },
  });

  const writeStream = fs.createWriteStream(absolutePath);

  try {
    await pipeline(readable, hashTransform, writeStream);
  } catch (err) {
    // Clean up partial file on error
    await fs.promises.unlink(absolutePath).catch(() => undefined);
    throw err;
  }

  return { hash: hashCtx.digest("hex"), sizeBytes };
}

export interface StorageSaveResult {
  hash: string;
  sizeBytes: number;
}

export const storage = {
  /**
   * Save a readable stream to `{STORAGE_PATH}/{relativePath}`.
   * Computes SHA-256 and byte count in a single pass.
   */
  async save(relativePath: string, readable: Readable): Promise<StorageSaveResult> {
    const abs = path.join(config.STORAGE_PATH, relativePath);
    return saveWithHash(abs, readable);
  },

  /**
   * Return a readable stream for an existing stored file.
   */
  readStream(relativePath: string): fs.ReadStream {
    return fs.createReadStream(path.join(config.STORAGE_PATH, relativePath));
  },

  /**
   * Delete a stored file. Silently ignores ENOENT.
   */
  async delete(relativePath: string): Promise<void> {
    await fs.promises
      .unlink(path.join(config.STORAGE_PATH, relativePath))
      .catch((err: unknown) => {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      });
  },

  /**
   * Copy a stored file from one relative path to another.
   * Creates any missing parent directories.
   */
  async copy(srcRelative: string, destRelative: string): Promise<void> {
    const src = path.join(config.STORAGE_PATH, srcRelative);
    const dest = path.join(config.STORAGE_PATH, destRelative);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(src, dest);
  },

  /**
   * Check whether a stored file exists.
   */
  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.promises.access(path.join(config.STORAGE_PATH, relativePath));
      return true;
    } catch {
      return false;
    }
  },
};
