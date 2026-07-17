import type { Response } from 'express';

/** Consistent response envelope used across every endpoint: `{ data, meta, error }`. */
export interface ApiMeta {
  traceId?: string;
  page?: number;
  limit?: number;
  total?: number;
  nextCursor?: string | null;
  [key: string]: unknown;
}

export interface ApiSuccess<T> {
  data: T;
  meta?: ApiMeta;
  error: null;
}

export interface ApiFailure {
  data: null;
  error: { message: string; code?: string; details?: unknown };
}

/** Send a success envelope. Defaults to 200; pass 201 for creations. */
export function sendSuccess<T>(res: Response, data: T, meta?: ApiMeta, status = 200): Response {
  const body: ApiSuccess<T> = meta ? { data, meta, error: null } : { data, error: null };
  return res.status(status).json(body);
}
