/**
 * Typed API client for the AsepriteSync server.
 *
 * All requests go to NEXT_PUBLIC_API_URL (defaults to http://localhost:4000).
 * The access token, when needed, must be passed explicitly — it is never read
 * from module state here (that's the auth context's responsibility).
 */

import type { ApiResult } from "@asepritesync/shared";

const BASE = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000";

// ---------------------------------------------------------------------------
// Low-level fetch wrapper
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(init.headers as HeadersInit | undefined);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: "include", // send the refresh cookie
  });

  const body = await res.json() as ApiResult<T>;

  if (body.error) {
    throw new ApiError(body.error.code, body.error.message, res.status, body.error.details);
  }

  return (body as { data: T }).data;
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

export interface LoginResult {
  accessToken: string;
  user: {
    id: string;
    email: string;
    username: string;
    avatarUrl: string | null;
  };
}

export interface RegisterResult {
  id: string;
  email: string;
  username: string;
}

// ---------------------------------------------------------------------------
// Helper for authenticated requests
// ---------------------------------------------------------------------------

export function authedRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  return request<T>(path, init, token);
}

// ---------------------------------------------------------------------------
// Projects endpoints
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  role: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectsPage {
  projects: Project[];
  meta: { cursor: string | null; hasMore: boolean };
}

export const projectsApi = {
  list(token: string, cursor?: string): Promise<Project[]> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return authedRequest<Project[]>(`/projects${qs}`, token);
  },

  get(token: string, id: string): Promise<Project> {
    return authedRequest<Project>(`/projects/${id}`, token);
  },

  create(token: string, input: { name: string; description?: string }): Promise<Project> {
    return authedRequest<Project>("/projects", token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  update(token: string, id: string, input: { name?: string; description?: string }): Promise<Project> {
    return authedRequest<Project>(`/projects/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  delete(token: string, id: string): Promise<void> {
    return authedRequest<void>(`/projects/${id}`, token, { method: "DELETE", body: "{}" });
  },
};

// ---------------------------------------------------------------------------
// Members endpoints
// ---------------------------------------------------------------------------

export interface ProjectMember {
  projectId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  role: string;
  joinedAt: string;
}

export const membersApi = {
  list(token: string, projectId: string): Promise<ProjectMember[]> {
    return authedRequest<ProjectMember[]>(`/projects/${projectId}/members`, token);
  },

  invite(token: string, projectId: string, input: { email: string; role: "editor" | "viewer" }): Promise<ProjectMember> {
    return authedRequest<ProjectMember>(`/projects/${projectId}/members`, token, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  updateRole(token: string, projectId: string, userId: string, role: "editor" | "viewer"): Promise<void> {
    return authedRequest<void>(`/projects/${projectId}/members/${userId}`, token, {
      method: "PUT",
      body: JSON.stringify({ role }),
    });
  },

  remove(token: string, projectId: string, userId: string): Promise<void> {
    return authedRequest<void>(`/projects/${projectId}/members/${userId}`, token, {
      method: "DELETE",
      body: "{}",
    });
  },
};

// ---------------------------------------------------------------------------
// Users (profile) endpoints
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export const usersApi = {
  me(token: string): Promise<UserProfile> {
    return authedRequest<UserProfile>("/users/me", token);
  },

  updateMe(token: string, input: { username?: string; avatarUrl?: string | null }): Promise<UserProfile> {
    return authedRequest<UserProfile>("/users/me", token, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
};

// ---------------------------------------------------------------------------
// Activity endpoint
// ---------------------------------------------------------------------------

export interface ActivityLog {
  id: string;
  userId: string;
  projectId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export const activityApi = {
  list(token: string, cursor?: string): Promise<ActivityLog[]> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return authedRequest<ActivityLog[]>(`/activity${qs}`, token);
  },
};

// ---------------------------------------------------------------------------
// Files endpoints
// ---------------------------------------------------------------------------

export interface FileRecord {
  id: string;
  projectId: string;
  name: string;
  path: string;
  currentVersionId: string | null;
  lockedBy: string | null;
  lockExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileVersion {
  id: string;
  fileId: string;
  versionNumber: number;
  authorId: string;
  hashSha256: string;
  sizeBytes: number;
  previewPath: string | null;
  isPinned: boolean;
  createdAt: string;
}

export interface UploadResult {
  id: string;
  name: string;
  version: FileVersion;
  metadata?: { width: number; height: number; frameCount: number; colorMode: string } | null;
}

export interface LockResult {
  fileId: string;
  lockedBy: string | null;
  lockExpiresAt: string | null;
}

async function multipartRequest<T>(
  path: string,
  token: string,
  formData: FormData,
  method = "POST",
): Promise<T> {
  // Do NOT set Content-Type — browser sets it with the multipart boundary
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
    credentials: "include",
  });
  const body = await res.json() as ApiResult<T>;
  if (body.error) throw new ApiError(body.error.code, body.error.message, res.status, body.error.details);
  return (body as { data: T }).data;
}

export const versionsApi = {
  list(token: string, fileId: string): Promise<FileVersion[]> {
    return authedRequest<FileVersion[]>(`/files/${fileId}/versions`, token);
  },

  restore(token: string, fileId: string, versionNumber: number): Promise<FileVersion> {
    return authedRequest<FileVersion>(`/files/${fileId}/versions/${versionNumber}/restore`, token, {
      method: "POST",
      body: "{}",
    });
  },
};

export const filesApi = {
  list(token: string, projectId: string, cursor?: string): Promise<FileRecord[]> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return authedRequest<FileRecord[]>(`/projects/${projectId}/files${qs}`, token);
  },

  upload(token: string, projectId: string, file: File): Promise<UploadResult> {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return multipartRequest<UploadResult>(`/projects/${projectId}/files`, token, fd);
  },

  update(token: string, fileId: string, file: File): Promise<UploadResult & { isDuplicate: boolean }> {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return multipartRequest<UploadResult & { isDuplicate: boolean }>(`/files/${fileId}`, token, fd, "PUT");
  },

  async download(token: string, fileId: string, filename: string): Promise<void> {
    const res = await fetch(`${BASE}/files/${fileId}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include",
    });
    if (!res.ok) throw new ApiError("DOWNLOAD_FAILED", "Download failed", res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  delete(token: string, fileId: string): Promise<void> {
    return authedRequest<void>(`/files/${fileId}`, token, { method: "DELETE", body: "{}" });
  },

  lock(token: string, fileId: string): Promise<LockResult> {
    return authedRequest<LockResult>(`/files/${fileId}/lock`, token, { method: "POST", body: "{}" });
  },

  unlock(token: string, fileId: string): Promise<LockResult> {
    return authedRequest<LockResult>(`/files/${fileId}/lock`, token, { method: "DELETE", body: "{}" });
  },

  /** Fetches the thumbnail PNG and returns a blob object URL. Caller must revoke it. */
  async preview(token: string, fileId: string): Promise<string> {
    const res = await fetch(`${BASE}/files/${fileId}/preview`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include",
    });
    if (!res.ok) throw new ApiError("PREVIEW_FAILED", "Preview unavailable", res.status);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
};

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

export const authApi = {
  login(email: string, password: string) {
    return request<LoginResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  register(username: string, email: string, password: string) {
    return request<RegisterResult>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    });
  },

  refresh() {
    return request<LoginResult>("/auth/refresh", { method: "POST", body: "{}" });
  },

  logout() {
    return request<{ message: string }>("/auth/logout", { method: "POST", body: "{}" });
  },

  requestPasswordReset(email: string) {
    return request<{ message: string }>("/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  applyPasswordReset(token: string, password: string) {
    return request<{ message: string }>("/auth/password-reset/apply", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
  },
};
