"use server";

import { tasks } from "@trigger.dev/sdk/v3";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/admin";
import type { TaskType } from "@/lib/types";
// Importing as `type` keeps this safe for the server bundle while
// still letting `tasks.trigger<typeof runTaskTask>(...)` infer payload types.
import type { runTaskTask } from "@/src/trigger/run-task";

const VALID_TYPES: ReadonlySet<TaskType> = new Set([
  "audit",
  "quick",
  "keywords",
  "technical",
  "backlinks",
  "rankings",
  "content_gap",
  "report_pdf",
]);

export interface RunTaskResult {
  taskId: string;
}

/**
 * Insert a `tasks` row for the given project + dispatch the Trigger.dev
 * `run-task` job. Returns the new task id so the caller can navigate to
 * the live timeline.
 *
 * Requires the caller to be authenticated and a member of the project's
 * workspace. Throws otherwise — the task buttons surface the error via
 * a toast.
 */
export async function runTask(
  projectId: string,
  type: TaskType,
  params: Record<string, unknown>,
): Promise<RunTaskResult> {
  if (!VALID_TYPES.has(type)) {
    throw new Error(`Unknown task type: ${type}`);
  }

  // 1. Authed user.
  const supabase = await createServerClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    throw new Error("Not authenticated. Please sign in.");
  }

  // 2. Resolve project + verify membership. Reading projects via the
  // anon-key/RLS-aware client is sufficient — the policy already
  // restricts to members.
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, workspace_id, domain")
    .eq("id", projectId)
    .single<{ id: string; workspace_id: string; domain: string }>();

  if (projErr || !project) {
    throw new Error("Project not found or you don't have access.");
  }
  // RLS on `projects` already enforces workspace membership — if the
  // select above returned a row, the user is a member. No second check
  // needed, and the supabase-js untyped client makes a follow-up
  // .maybeSingle() flaky anyway.

  // 4. Insert the queued tasks row using the service-role client so
  // we control exactly which columns are set; RLS on `tasks` would
  // also allow this insert via the user client, but going through
  // service-role keeps the audit trail consistent with Trigger.dev /
  // worker writes that follow.
  const admin = getServiceClient();
  // TODO: replace with generated types from `supabase gen types`. The
  // hand-written Database shape doesn't satisfy supabase-js 2.105's
  // stricter Insert generic, so cast the payload through `unknown` to
  // unblock the build.
  const insertPayload = {
    project_id: project.id,
    type,
    status: "queued",
    params_json: params,
    created_by: user.id,
  } as unknown as never;
  const { data: inserted, error: insertErr } = await admin
    .from("tasks")
    .insert(insertPayload)
    .select("id")
    .single<{ id: string }>();

  if (insertErr || !inserted) {
    throw new Error(
      `Failed to enqueue task: ${insertErr?.message ?? "unknown"}`,
    );
  }

  const taskId = inserted.id as string;

  // 5. Dispatch via Trigger.dev. We use the namespaced `tasks.trigger`
  // form so we don't have to import the runtime task module from a
  // server action (Next was occasionally tripping over the trigger
  // SDK's worker-side imports during bundling).
  try {
    await tasks.trigger<typeof runTaskTask>("run-task", { taskId });
  } catch (err) {
    // Mark the row failed so the UI doesn't sit forever in `queued`.
    await admin
      .from("tasks")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: `Trigger.dev dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
      })
      .eq("id", taskId);
    throw err;
  }

  return { taskId };
}
