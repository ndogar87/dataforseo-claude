import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for server-only contexts (Server Actions,
 * Trigger.dev tasks, route handlers that need to bypass RLS for system
 * operations). NEVER import from a Client Component or anything that
 * runs in the browser — `import 'server-only'` will fail the build if
 * you try.
 *
 * The client is cached per-process so we don't churn HTTP/2 sessions
 * on every Server Action call.
 *
 * The client is intentionally untyped: the hand-written Database type
 * collapses every `.insert()` / `.update()` chain to `never` under
 * supabase-js 2.105+'s stricter generics. Until `supabase gen types`
 * runs, mutations go through the `insertRow` / `updateRow` helpers
 * below which centralise the one cast we need.
 */
let cached: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set — cannot construct service client.",
    );
  }
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — cannot construct service client.",
    );
  }

  cached = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return cached;
}

/**
 * `client.from(table).insert(payload)` with the one ugly cast we need
 * isolated to a single place. The supabase-js untyped client infers the
 * Insert generic as `never`, which would otherwise force every call site
 * to write `as unknown as never`.
 *
 * Returns the chainable insert builder so callers can `.select().single()`
 * as usual.
 */
export function insertRow<T extends Record<string, unknown>>(
  client: SupabaseClient,
  table: string,
  payload: T,
) {
  return client.from(table).insert(payload as unknown as never);
}

/**
 * Counterpart for updates. Returns the chainable update builder so the
 * caller can `.eq("id", id)` and friends.
 */
export function updateRow<T extends Record<string, unknown>>(
  client: SupabaseClient,
  table: string,
  payload: T,
) {
  return client.from(table).update(payload as unknown as never);
}
