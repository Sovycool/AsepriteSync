import type { ApiError, ApiMeta, ApiResponse, ApiErrorResponse } from "@asepritesync/shared";

export function ok<T>(data: T, meta?: ApiMeta): ApiResponse<T> {
  return { data, error: null, ...(meta !== undefined && { meta }) };
}

export function err(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ApiErrorResponse {
  const error: ApiError = { code, message, ...(details !== undefined && { details }) };
  return { data: null, error };
}
