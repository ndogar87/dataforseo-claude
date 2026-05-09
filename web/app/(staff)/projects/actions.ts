"use server";

import { revalidatePath } from "next/cache";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/admin";

export interface CreateProjectInput {
  domain: string;
  displayName: string;
}

export type CreateProjectResult =
  | { ok: true; projectId: string }
  | { ok: false; error: string };

/**
 * Normalize a user-entered domain:
 *   - trim
 *   - lowercase
 *   - strip protocol (http://, https://)
 *   - strip leading "www."
 *   - strip path / query / hash
 *
 * Empty string after normalization is treated as invalid by the caller.
 */
function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  // Drop anything after the first slash, ?, or #.
  const cut = d.search(/[\/?#]/);
  if (cut !== -1) d = d.slice(0, cut);
  return d;
}

/**
 * Create a new project in the caller's workspace.
 *
 * Auth-aware. Resolves the user's workspace via `workspace_members`,
 * preferring `owner` over `staff` when the user is in multiple
 * workspaces (Phase 1 typically has exactly one). Then INSERTs the
 * project row using the service-role client to mirror the pattern in
 * `[id]/actions.ts`.
 *
 * Returns `{ ok: true, projectId }` on success so the caller can
 * `router.push` to the new detail page; `{ ok: false, error }` on
 * any failure (auth, no workspace, bad input, db error).
 */
export async function createProject(
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  const domain = normalizeDomain(input.domain ?? "");
  const displayName = (input.displayName ?? "").trim();

  if (!domain) {
    return { ok: false, error: "Domain is required." };
  }
  if (!displayName) {
    return { ok: false, error: "Display name is required." };
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

  // 2. Find the user's workspace. Prefer owner, fall back to staff.
  // Designed to handle the multi-workspace case even though Phase 1
  // launches with exactly one workspace per user.
  const { data: membershipsData, error: memberErr } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id);

  if (memberErr) {
    return {
      ok: false,
      error: `Couldn't resolve workspace: ${memberErr.message}`,
    };
  }

  const memberships =
    (membershipsData as { workspace_id: string; role: string }[] | null) ?? [];

  const ownerMembership = memberships.find((m) => m.role === "owner");
  const staffMembership = memberships.find((m) => m.role === "staff");
  const chosen = ownerMembership ?? staffMembership ?? null;

  if (!chosen) {
    return {
      ok: false,
      error:
        "No workspace found for your account. Ask an admin to add you as owner or staff.",
    };
  }

  // 3. Insert the project via service-role to keep insert audit trail
  // consistent with other server actions (see [id]/actions.ts).
  const admin = getServiceClient();
  const insertPayload = {
    workspace_id: chosen.workspace_id,
    domain,
    display_name: displayName,
  } as unknown as never;

  const { data: inserted, error: insertErr } = await admin
    .from("projects")
    .insert(insertPayload)
    .select("id")
    .single<{ id: string }>();

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: `Failed to create project: ${insertErr?.message ?? "unknown"}`,
    };
  }

  revalidatePath("/projects");

  return { ok: true, projectId: inserted.id };
}
