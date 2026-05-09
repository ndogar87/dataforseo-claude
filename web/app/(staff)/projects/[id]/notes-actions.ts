"use server";

import { revalidatePath } from "next/cache";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/admin";

export type SaveNotesResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Persist the markdown notes textarea on a project.
 *
 * Auth-aware. RLS on `projects` already restricts SELECT to workspace
 * members, so a successful read here proves membership. We then UPDATE
 * via the service-role client to keep mutation provenance consistent
 * with the rest of the actions in this directory.
 */
export async function saveProjectNotes(
  projectId: string,
  notesMd: string,
): Promise<SaveNotesResult> {
  if (typeof projectId !== "string" || projectId.length === 0) {
    return { ok: false, error: "Missing project id." };
  }

  // 1. Authed user.
  const supabase = await createServerClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return { ok: false, error: "Not authenticated. Please sign in." };
  }

  // 2. Verify project access via RLS-aware read. If the user isn't a
  // member of the project's workspace, this returns null and we bail
  // before touching the service-role client.
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle<{ id: string }>();

  if (projErr) {
    return { ok: false, error: `Couldn't load project: ${projErr.message}` };
  }
  if (!project) {
    return { ok: false, error: "Project not found or you don't have access." };
  }

  // 3. Update via service-role.
  const admin = getServiceClient();
  const updatePayload = {
    notes_md: notesMd ?? "",
    updated_at: new Date().toISOString(),
  } as unknown as never;

  const { error: updateErr } = await admin
    .from("projects")
    .update(updatePayload)
    .eq("id", projectId);

  if (updateErr) {
    return {
      ok: false,
      error: `Failed to save notes: ${updateErr.message}`,
    };
  }

  revalidatePath(`/projects/${projectId}`);

  return { ok: true };
}
