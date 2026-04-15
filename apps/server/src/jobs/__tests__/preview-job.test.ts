import { describe, it, expect, vi, beforeEach } from "vitest";
import { enqueuePreviewJob } from "../preview-job.js";
import type { FilesRepository } from "../../modules/files/files.repository.js";
import type { Database } from "@asepritesync/db";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../lib/preview.js", () => ({
  generatePreviews: vi.fn().mockResolvedValue({ thumbPath: "proj/file/v1_thumb.png", animPath: "proj/file/v1_anim.gif" }),
}));

const mockRepo: Pick<FilesRepository, "updateVersionPreviewPath"> = {
  updateVersionPreviewPath: vi.fn().mockResolvedValue(undefined),
};

const mockDb = {} as unknown as Database;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("enqueuePreviewJob", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("calls generatePreviews and updates the preview path on success", async () => {
    const { generatePreviews } = await import("../../lib/preview.js");

    enqueuePreviewJob({
      db: mockDb,
      repo: mockRepo as unknown as FilesRepository,
      projectId: "proj",
      fileId: "file",
      versionId: "v1",
      storagePath: "proj/file/1.aseprite",
    });

    // Wait for the setImmediate + async work
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(generatePreviews).toHaveBeenCalledWith(
      "proj/file/1.aseprite",
      "proj/file/1",  // extension stripped
    );
    expect(mockRepo.updateVersionPreviewPath).toHaveBeenCalledWith(
      "v1",
      "proj/file/v1_thumb.png",
    );
  });

  it("does not update preview path when generatePreviews returns null paths", async () => {
    const { generatePreviews } = await import("../../lib/preview.js");
    vi.mocked(generatePreviews).mockResolvedValueOnce({ thumbPath: null, animPath: null });

    enqueuePreviewJob({
      db: mockDb,
      repo: mockRepo as unknown as FilesRepository,
      projectId: "proj",
      fileId: "file",
      versionId: "v1",
      storagePath: "proj/file/1.aseprite",
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockRepo.updateVersionPreviewPath).not.toHaveBeenCalled();
  });

  it("returns immediately without blocking", () => {
    const start = Date.now();
    enqueuePreviewJob({
      db: mockDb,
      repo: mockRepo as unknown as FilesRepository,
      projectId: "proj",
      fileId: "file",
      versionId: "v1",
      storagePath: "proj/file/1.aseprite",
    });
    // Should complete in < 5 ms (synchronous return)
    expect(Date.now() - start).toBeLessThan(50);
  });
});
