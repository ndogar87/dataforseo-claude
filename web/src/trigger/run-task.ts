import { logger, task } from "@trigger.dev/sdk/v3";
import { createClient } from "@supabase/supabase-js";

import type { TaskType } from "@/lib/types";

/**
 * `run-task` is the single Trigger.dev task that drives every SEO task
 * end to end:
 *
 *   queued (set by the Server Action that inserted the row)
 *   ↓ (Trigger.dev fires this task with `{ taskId }`)
 *   running (we set started_at + status='running' here)
 *   ↓ (POST to the FastAPI worker — synchronous, can take minutes)
 *   succeeded | failed (we set finished_at + cost_usd or error)
 *
 * The worker writes its own `task_steps` rows directly to Supabase via
 * its service-role token, so we don't have to stream anything out of
 * here — Trigger.dev just needs to know whether the worker call was OK
 * and what it cost.
 *
 * NOTE: the parent route in `trigger.config.ts` already sets
 * `maxDuration: 3600`, which comfortably covers a 2–5 minute audit.
 */

interface RunTaskPayload {
  taskId: string;
}

interface WorkerSuccess {
  ok: true;
  task_id: string;
  type: string;
  iterations: number;
  stop_reason: string | null;
  cost_usd: number;
  usage: Record<string, number>;
  tool_calls: number;
  duration_ms: number;
  final_text: string;
}

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export const runTaskTask = task({
  id: "run-task",
  // Per-run cap; trigger.config.ts also sets a global cap.
  maxDuration: 3600,
  run: async (payload: RunTaskPayload) => {
    const { taskId } = payload;
    if (!taskId) throw new Error("run-task: missing taskId");

    const supabase = adminClient();
    const workerUrl = process.env.WORKER_URL;
    if (!workerUrl) throw new Error("WORKER_URL not set");
    // Shared secret authenticates this dispatcher to the worker. We
    // require it whenever the worker is on a non-localhost URL — i.e.
    // anywhere it's actually reachable from the public internet.
    const workerSecret = (process.env.WORKER_SHARED_SECRET ?? "").trim();
    const isLocalWorker = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(workerUrl);
    if (!workerSecret && !isLocalWorker) {
      throw new Error(
        "WORKER_SHARED_SECRET is not set; refusing to dispatch to a non-local worker.",
      );
    }

    // 1. Read the queued task row.
    const { data: row, error: readErr } = await supabase
      .from("tasks")
      .select("id, type, params_json, status, project_id")
      .eq("id", taskId)
      .single();

    if (readErr || !row) {
      throw new Error(
        `run-task: cannot read tasks row ${taskId}: ${readErr?.message ?? "not found"}`,
      );
    }

    const taskType = row.type as TaskType;
    const params = (row.params_json ?? {}) as Record<string, unknown>;

    // 2. Mark running.
    const { error: updErr } = await supabase
      .from("tasks")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", taskId);
    if (updErr) {
      logger.warn("Failed to mark task running", { taskId, err: updErr.message });
    }

    // 3. Call the worker. This is synchronous — Trigger.dev's
    // maxDuration covers the long tail.
    const url = workerUrl.replace(/\/+$/, "") + "/run";
    logger.log("Dispatching to worker", { taskId, type: taskType, url });

    let resp: Response;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (workerSecret) headers["X-Worker-Secret"] = workerSecret;
      resp = await fetch(url, {
        method: "POST",
        headers,
        // The worker reads its own SUPABASE_SERVICE_ROLE_KEY from env;
        // we deliberately do NOT send a service-role token in the body.
        body: JSON.stringify({
          task_id: taskId,
          type: taskType,
          params,
        }),
      });
    } catch (fetchErr) {
      const message =
        fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      await supabase
        .from("tasks")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: `Worker fetch failed: ${message}`,
        })
        .eq("id", taskId);
      throw fetchErr;
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "<no body>");
      await supabase
        .from("tasks")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: `Worker returned ${resp.status}: ${text.slice(0, 1000)}`,
        })
        .eq("id", taskId);
      throw new Error(`Worker returned ${resp.status}: ${text.slice(0, 200)}`);
    }

    let body: WorkerSuccess;
    try {
      body = (await resp.json()) as WorkerSuccess;
    } catch (parseErr) {
      const message =
        parseErr instanceof Error ? parseErr.message : String(parseErr);
      await supabase
        .from("tasks")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: `Worker response not JSON: ${message}`,
        })
        .eq("id", taskId);
      throw parseErr;
    }

    // 4. Mark succeeded with the cost the worker reports.
    const { error: doneErr } = await supabase
      .from("tasks")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        cost_usd: body.cost_usd ?? 0,
        error: null,
      })
      .eq("id", taskId);
    if (doneErr) {
      logger.warn("Failed to mark task succeeded", {
        taskId,
        err: doneErr.message,
      });
    }

    return {
      taskId,
      type: taskType,
      iterations: body.iterations,
      cost_usd: body.cost_usd,
      tool_calls: body.tool_calls,
      duration_ms: body.duration_ms,
    };
  },
});
