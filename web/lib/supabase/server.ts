import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client. Use in Server Components, Route Handlers,
 * and Server Actions. Reads cookies via next/headers.
 *
 * If env vars are missing the client is created with empty strings so the
 * app does not crash at build/dev time. Real queries will fail until env
 * is configured — that is intentional for the skeleton.
 *
 * Untyped on purpose — see lib/supabase/admin.ts.
 */
export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[],
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component — cookies are read-only there.
          // The middleware will refresh sessions instead.
        }
      },
    },
  });
}
