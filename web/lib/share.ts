import "server-only";

import { randomBytes } from "crypto";

/**
 * 32 random bytes, encoded as URL-safe base64 (no padding). 43 chars
 * with ~256 bits of entropy — far more than enough to make guessing
 * a valid token computationally infeasible.
 */
export function mintShareToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Build the absolute /share/<token> URL using NEXT_PUBLIC_APP_URL when
 * configured (production), otherwise fall back to localhost so this
 * works out of the box during development.
 */
export function buildShareUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "http://localhost:3000";
  return `${base}/share/${token}`;
}

/**
 * True if the existing token is still good for at least the next 7
 * days. Used to decide whether to reuse a previously-minted token or
 * rotate to a fresh one.
 */
export function tokenIsFresh(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const expiresMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresMs)) return false;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return expiresMs > Date.now() + sevenDaysMs;
}

/**
 * Default 30-day expiry, returned as an ISO string suitable for
 * inserting into a `timestamptz` column.
 */
export function defaultExpiry(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}
