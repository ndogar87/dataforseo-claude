import { redirect } from "next/navigation";

import { createClient as createServerClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

/**
 * Login page (server shell). If the user is already signed in, send them
 * straight to /projects so they don't see the form for an instant before
 * a client-side bounce. The actual sign-in form is a Client Component
 * because it needs `useState` for the email/password fields.
 *
 * Phase 1 is staff-only — we deliberately do NOT show a "Sign up" link.
 * Public signup ships in Phase 2 (see plan.md).
 */
export default async function LoginPage() {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/projects");
  } catch {
    // Supabase env vars not configured (build-time / dev). Fall through
    // to the form so the user sees a sensible error from the sign-in
    // call rather than a 500.
  }

  return <LoginForm />;
}
