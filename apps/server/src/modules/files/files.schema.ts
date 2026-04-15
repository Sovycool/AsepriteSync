import { z } from "zod";

export const ALLOWED_EXTENSIONS = [".aseprite", ".ase"] as const;

export const listFilesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const batchDownloadSchema = z.object({
  fileIds: z
    .array(z.string().uuid())
    .min(1, "At least one file ID required")
    .max(50, "At most 50 files per batch"),
});

export type ListFilesQuery = z.infer<typeof listFilesQuerySchema>;
export type BatchDownloadInput = z.infer<typeof batchDownloadSchema>;
