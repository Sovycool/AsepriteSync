/**
 * Minimal Aseprite binary file header parser.
 *
 * Reference: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
 *
 * The header occupies the first 128 bytes of every .aseprite / .ase file.
 * We only need the first 14 bytes for basic metadata.
 */

export interface AsepriteMetadata {
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** Total number of animation frames. */
  frameCount: number;
  /** Raw color-depth value: 32 = RGBA, 16 = Grayscale, 8 = Indexed. */
  colorDepth: 8 | 16 | 32;
  /** Human-readable color mode. */
  colorMode: "rgba" | "grayscale" | "indexed";
}

/** Magic number that identifies a valid Aseprite file. */
const MAGIC = 0xa5e0;

/** Minimum bytes required to parse the header. */
const MIN_HEADER_BYTES = 14;

/**
 * Parse the Aseprite file header from a Buffer.
 * Only the first {@link MIN_HEADER_BYTES} bytes are required.
 *
 * Throws if the buffer is too small or the magic number is wrong.
 */
export function parseAsepriteHeader(buf: Buffer): AsepriteMetadata {
  if (buf.length < MIN_HEADER_BYTES) {
    throw new Error(
      `Buffer too small for Aseprite header (need ${MIN_HEADER_BYTES} bytes, got ${buf.length})`,
    );
  }

  const magic = buf.readUInt16LE(4);
  if (magic !== MAGIC) {
    throw new Error(
      `Not a valid Aseprite file (magic 0x${magic.toString(16).toUpperCase()}, expected 0xA5E0)`,
    );
  }

  const frameCount = buf.readUInt16LE(6);
  const width = buf.readUInt16LE(8);
  const height = buf.readUInt16LE(10);
  const rawDepth = buf.readUInt16LE(12);

  const colorDepth: 8 | 16 | 32 =
    rawDepth === 32 ? 32 : rawDepth === 16 ? 16 : 8;

  const colorMode: AsepriteMetadata["colorMode"] =
    colorDepth === 32 ? "rgba" : colorDepth === 16 ? "grayscale" : "indexed";

  return { width, height, frameCount, colorDepth, colorMode };
}

/**
 * Read the first {@link MIN_HEADER_BYTES} bytes from a readable and parse them.
 * Used during upload to extract metadata without a second full-file pass.
 */
export async function readAsepriteMetadata(filePath: string): Promise<AsepriteMetadata | null> {
  try {
    const { open } = await import("node:fs/promises");
    const fh = await open(filePath, "r");
    try {
      const buf = Buffer.alloc(MIN_HEADER_BYTES);
      const { bytesRead } = await fh.read(buf, 0, MIN_HEADER_BYTES, 0);
      if (bytesRead < MIN_HEADER_BYTES) return null;
      return parseAsepriteHeader(buf);
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}
