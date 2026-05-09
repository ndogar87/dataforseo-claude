"use server";

import { tasks } from "@trigger.dev/sdk/v3";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { getServiceClient, insertRow, updateRow } from "@/lib/supabase/admin";
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

/**
 * Lightweight per-type shape check for the user-supplied params. Claude
 * itself is forgiving of unknown keys, but we'd rather fail fast on the
 * web side than spend cents booting a Claude run for an obviously
 * malformed payload (no seed for keywords, no keywords list for
 * rankings, etc.).
 *
 * Returns null when the params are acceptable, or a short user-facing
 * error message otherwise. Domain is checked at the top level since
 * every task type passes through {domain, ...extra} from task-buttons.
 */
function validateTaskParams(
  type: TaskType,
  params: Record<string, unknown>,
): string | null {
  const requireString = (key: string): string | null => {
    const v = params[key];
    if (typeof v !== "string" || v.trim().length === 0) {
      return `Missing required parameter '${key}' for task type '${type}'.`;
    }
    return null;
  };

  // Most task types operate on a project domain; the report_pdf type
  // operates on a previously-produced audit blob and doesn't need one.
  if (type !== "report_pdf") {
    const err = requireString("domain");
    if (err) return err;
  }

  switch (type) {
    case "keywords": {
      return requireString("seed");
    }
    case "rankings": {
      const v = params.keywords;
      if (!Array.isArray(v) || v.length === 0) {
        return "Rankings tasks need a non-empty 'keywords' array.";
      }
      const allStrings = v.every(
        (k) => typeof k === "string" && k.trim().length > 0,
      );
      if (!allStrings) {
        return "Rankings keywords must all be non-empty strings.";
      }
      return null;
    }
    case "content_gap": {
      return requireString("competitor_domain");
    }
    default:
      return null;
  }
}

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

  // Validate per-type param shape *before* we authenticate or hit the
  // database. Cheap up-front check; saves us from inserting a queued
  // task row + spinning Claude up for a payload that's obviously bad.
  const shapeErr = validateTaskParams(type, params);
  if (shapeErr) {
    throw new Error(shapeErr);
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

  // 3. Insert the queued tasks row using the service-role client so
  // we control exactly which columns are set; RLS on `tasks` would
  // also allow this insert via the user client, but going through
  // service-role keeps the audit trail consistent with Trigger.dev /
  // worker writes that follow.
  const admin = getServiceClient();
  const { data: inserted, error: insertErr } = await insertRow(admin, "tasks", {
    project_id: project.id,
    type,
    status: "queued",
    params_json: params,
    created_by: user.id,
  })
    .select("id")
    .single<{ id: string }>();

  if (insertErr || !inserted) {
    throw new Error(
      `Failed to enqueue task: ${insertErr?.message ?? "unknown"}`,
    );
  }

  const taskId = inserted.id as string;

  // 4. Dispatch via Trigger.dev. We use the namespaced `tasks.trigger`
  // form so we don't have to import the runtime task module from a
  // server action (Next was occasionally tripping over the trigger
  // SDK's worker-side imports during bundling).
  try {
    await tasks.trigger<typeof runTaskTask>("run-task", { taskId });
  } catch (err) {
    // Mark the row failed so the UI doesn't sit forever in `queued`.
    await updateRow(admin, "tasks", {
      status: "failed",
      finished_at: new Date().toISOString(),
      error: `Trigger.dev dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    }).eq("id", taskId);
    throw err;
  }

  return { taskId };
}
