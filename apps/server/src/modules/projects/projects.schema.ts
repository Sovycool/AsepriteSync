import { z } from "zod";

export const createProjectSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters"),
  description: z.string().max(500, "Description must be at most 500 characters").optional(),
});

export const updateProjectSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters")
    .optional(),
  description: z
    .string()
    .max(500, "Description must be at most 500 characters")
    .nullable()
    .optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.enum(["editor", "viewer"]),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(["editor", "viewer"]),
});

export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
export type ListQueryInput = z.infer<typeof listQuerySchema>;
