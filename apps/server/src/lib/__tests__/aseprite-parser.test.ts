import { describe, it, expect } from "vitest";
import { parseAsepriteHeader } from "../aseprite-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a minimal Aseprite-compatible 128-byte header buffer.
 * All fields default to a valid 32×32 RGBA single-frame file.
 */
function makeHeader({
  magic = 0xa5e0,
  frameCount = 1,
  width = 32,
  height = 32,
  colorDepth = 32,
}: {
  magic?: number;
  frameCount?: number;
  width?: number;
  height?: number;
  colorDepth?: number;
} = {}): Buffer {
  const buf = Buffer.alloc(128, 0);
  // offset 0: file size (DWORD) — we set something plausible
  buf.writeUInt32LE(128, 0);
  buf.writeUInt16LE(magic, 4);
  buf.writeUInt16LE(frameCount, 6);
  buf.writeUInt16LE(width, 8);
  buf.writeUInt16LE(height, 10);
  buf.writeUInt16LE(colorDepth, 12);
  return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseAsepriteHeader", () => {
  it("parses a valid RGBA single-frame header", () => {
    const meta = parseAsepriteHeader(makeHeader());
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(32);
    expect(meta.frameCount).toBe(1);
    expect(meta.colorDepth).toBe(32);
    expect(meta.colorMode).toBe("rgba");
  });

  it("parses a multi-frame sprite", () => {
    const meta = parseAsepriteHeader(makeHeader({ frameCount: 12, width: 64, height: 64 }));
    expect(meta.frameCount).toBe(12);
    expect(meta.width).toBe(64);
    expect(meta.height).toBe(64);
  });

  it("reports colorMode=grayscale for depth 16", () => {
    const meta = parseAsepriteHeader(makeHeader({ colorDepth: 16 }));
    expect(meta.colorDepth).toBe(16);
    expect(meta.colorMode).toBe("grayscale");
  });

  it("reports colorMode=indexed for depth 8", () => {
    const meta = parseAsepriteHeader(makeHeader({ colorDepth: 8 }));
    expect(meta.colorDepth).toBe(8);
    expect(meta.colorMode).toBe("indexed");
  });

  it("treats unknown colorDepth as indexed (8)", () => {
    const meta = parseAsepriteHeader(makeHeader({ colorDepth: 24 }));
    expect(meta.colorDepth).toBe(8);
    expect(meta.colorMode).toBe("indexed");
  });

  it("throws when the buffer is too small", () => {
    expect(() => parseAsepriteHeader(Buffer.alloc(10))).toThrow(/too small/i);
  });

  it("throws when the magic number is wrong", () => {
    expect(() => parseAsepriteHeader(makeHeader({ magic: 0xdead }))).toThrow(
      /valid Aseprite/i,
    );
  });

  it("accepts a buffer larger than 128 bytes", () => {
    const big = Buffer.concat([makeHeader(), Buffer.alloc(512)]);
    expect(() => parseAsepriteHeader(big)).not.toThrow();
  });
});
