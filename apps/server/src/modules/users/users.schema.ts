import { z } from "zod";

export const updateProfileSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(32, "Username must be at most 32 characters")
    .regex(/^[a-zA-Z0-9_-]+$/, "Username may only contain letters, digits, underscores and hyphens")
    .optional(),
  avatarUrl: z.string().url("Invalid URL").nullable().optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
