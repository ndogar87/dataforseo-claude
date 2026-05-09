"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client. Use in Client Components.
 * Suitable for Realtime subscriptions and user-facing reads / mutations
 * scoped by RLS to the signed-in user.
 *
 * NOTE: untyped on purpose — see lib/supabase/admin.ts.
 */
export function createClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return createBrowserClient(url, anonKey);
}
