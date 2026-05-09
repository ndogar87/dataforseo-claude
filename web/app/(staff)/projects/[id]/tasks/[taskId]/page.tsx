import Link from "next/link";
import { notFound } from "next/navigation";

import { Separator } from "@/components/ui/separator";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/admin";
import type {
  DeliverableRow,
  TaskRow,
  TaskStepRow,
} from "@/lib/types";

import { TaskTimeline } from "./task-timeline";

export default async function TaskTimelinePage({
  params,
}: {
  params: Promise<{ id: string; taskId: string }>;
}) {
  const { id, taskId } = await params;

  const supabase = await createServerClient();

  // Project — RLS-scoped read.
  const { data: project } = await supabase
    .from("projects")
    .select("id, display_name, domain")
    .eq("id", id)
    .single();
  if (!project) notFound();

  // Task — RLS-scoped read.
  const { data: taskData } = await supabase
    .from("tasks")
    .select(
      "id, project_id, type, status, params_json, created_by, created_at, started_at, finished_at, cost_usd, error",
    )
    .eq("id", taskId)
    .single();
  if (!taskData) notFound();
  const task = taskData as TaskRow;

  // Initial steps.
  const { data: stepsData } = await supabase
    .from("task_steps")
    .select(
      "id, task_id, idx, label, status, payload_json, started_at, finished_at",
    )
    .eq("task_id", taskId)
    .order("idx", { ascending: true });
  const steps = (stepsData ?? []) as TaskStepRow[];

  // Initial deliverables — used to render the download links if the
  // task has already finished by the time we render server-side.
  const { data: deliverablesData } = await supabase
    .from("deliverables")
    .select("id, task_id, kind, storage_path, public_token, expires_at, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });
  const deliverables = (deliverablesData ?? []) as DeliverableRow[];

  // For any deliverables that exist, mint a short-lived signed URL
  // server-side so the client can render a working download link
  // without ever holding the service-role key.
  const signedUrls = await mintSignedUrls(deliverables);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Link
            href={`/projects/${project.id}`}
            className="text-xs text-muted-foreground hover:underline"
          >
            ← {project.display_name}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight capitalize">
            {task.type.replace("_", " ")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {task.created_at
              ? `Started ${new Date(task.created_at).toLocaleString()}`
              : null}
          </p>
        </div>
      </div>

      <Separator />

      <TaskTimeline
        initialTask={task}
        initialSteps={steps}
        initialDeliverables={deliverables}
        initialSignedUrls={signedUrls}
        projectId={project.id}
      />
    </div>
  );
}

/**
 * Build `{ deliverableId: signedUrl }` for every deliverable. Uses the
 * service-role client so we don't need the user's JWT to mint URLs;
 * the URL itself is signed and time-limited. A 1-hour expiry is more
 * than enough for the page to render, and the client component will
 * re-fetch via its own Supabase client when new deliverables arrive
 * via Realtime.
 */
async function mintSignedUrls(
  deliverables: DeliverableRow[],
): Promise<Record<string, string>> {
  if (deliverables.length === 0) return {};
  const out: Record<string, string> = {};

  // The worker writes `storage_path` in the form `deliverables/<task>/<file>`.
  // The Storage API wants the path *without* the bucket prefix.
  const admin = getServiceClient();
  await Promise.all(
    deliverables.map(async (d) => {
      const objectPath = stripBucketPrefix(d.storage_path);
      try {
        const { data, error } = await admin.storage
          .from("deliverables")
          .createSignedUrl(objectPath, 3600);
        if (!error && data?.signedUrl) {
          out[d.id] = data.signedUrl;
        }
      } catch {
        // Swallow — the client will fall back to a "Download unavailable" hint.
      }
    }),
  );
  return out;
}

function stripBucketPrefix(storagePath: string): string {
  const prefix = "deliverables/";
  return storagePath.startsWith(prefix)
    ? storagePath.slice(prefix.length)
    : storagePath;
}
