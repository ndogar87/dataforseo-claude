import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  // TODO: replace with real auth check once Supabase is configured.
  // For now, attempt to read the user; if Supabase is not configured the
  // call resolves to no user and we redirect to /login.
  let isAuthed = false;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    isAuthed = Boolean(data.user);
  } catch {
    isAuthed = false;
  }

  redirect(isAuthed ? "/projects" : "/login");
}
