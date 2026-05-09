import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  // If Supabase isn't configured the auth call throws — fall through to /login.
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
