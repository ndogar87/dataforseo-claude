"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Download, Share2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { DeliverableRow, TaskRow, TaskStepRow } from "@/lib/types";

import { mintDeliverableUrl } from "./actions";
import { ShareDialog } from "./share-dialog";
import {
  PayloadSummary,
  StatusBadge,
  StepIcon,
  durationLabel,
} from "./step-row";

interface TaskTimelineProps {
  initialTask: TaskRow;
  initialSteps: TaskStepRow[];
  initialDeliverables: DeliverableRow[];
  initialSignedUrls: Record<string, string>;
  projectId: string;
}

// Per-channel Realtime state. The Supabase status callback emits
// SUBSCRIBED on success and CHANNEL_ERROR / TIMED_OUT / CLOSED on
// failure; we collapse the failure modes to a single "error" state for
// the UI banner and keep the connecting → subscribed transition
// distinct so we can show "Connecting…" briefly on first paint.
type RealtimeState = "connecting" | "subscribed" | "error";

export function TaskTimeline({
  initialTask,
  initialSteps,
  initialDeliverables,
  initialSignedUrls,
  projectId: _projectId,
}: TaskTimelineProps) {
  const supabase = useMemo(() => createBrowserClient(), []);

  const [task, setTask] = useState<TaskRow>(initialTask);
  const [steps, setSteps] = useState<TaskStepRow[]>(initialSteps);
  const [deliverables, setDeliverables] =
    useState<DeliverableRow[]>(initialDeliverables);
  const [signedUrls, setSignedUrls] =
    useState<Record<string, string>>(initialSignedUrls);

  // Realtime channel state. We track each channel independently so the
  // UI can show a "Reconnecting…" hint when any of them aren't healthy.
  // SUBSCRIBED is the only good state; CHANNEL_ERROR / TIMED_OUT /
  // CLOSED all warrant a notice. Initial state is "connecting".
  const [stepsState, setStepsState] = useState<RealtimeState>("connecting");
  const [taskState, setTaskState] = useState<RealtimeState>("connecting");
  const [deliverableState, setDeliverableState] =
    useState<RealtimeState>("connecting");

  // Track which deliverables we've already minted URLs for client-side
  // so we don't spam Storage on every re-render.
  const mintedRef = useRef<Set<string>>(
    new Set(Object.keys(initialSignedUrls)),
  );

  const [shareTarget, setShareTarget] = useState<DeliverableRow | null>(null);

  // ------------------------------------------------------------------
  // Realtime subscriptions: task_steps + tasks + deliverables, all
  // filtered down to this single task row.
  // ------------------------------------------------------------------
  useEffect(() => {
    const taskId = initialTask.id;

    const handleStatus =
      (label: string, set: (s: RealtimeState) => void) =>
      (status: string, err?: Error) => {
        if (status === "SUBSCRIBED") {
          set("subscribed");
          return;
        }
        // Anything else is a real signal worth surfacing. We log to the
        // console so a dev can spot it; the UI shows a small banner.
        // Don't echo any task data — keep this strictly diagnostic.
        console.error(`[realtime] ${label} channel: ${status}`, err);
        set("error");
      };

    const stepsChannel = supabase
      .channel(`task-steps:${taskId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "task_steps",
          filter: `task_id=eq.${taskId}`,
        },
        (payload) => {
          const next = payload.new as TaskStepRow;
          setSteps((prev) => mergeStep(prev, next));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "task_steps",
          filter: `task_id=eq.${taskId}`,
        },
        (payload) => {
          const next = payload.new as TaskStepRow;
          setSteps((prev) => mergeStep(prev, next));
        },
      )
      .subscribe(handleStatus("task_steps", setStepsState));

    const taskChannel = supabase
      .channel(`task:${taskId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tasks",
          filter: `id=eq.${taskId}`,
        },
        (payload) => {
          const next = payload.new as TaskRow;
          setTask(next);
        },
      )
      .subscribe(handleStatus("tasks", setTaskState));

    const deliverableChannel = supabase
      .channel(`deliverables:${taskId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "deliverables",
          filter: `task_id=eq.${taskId}`,
        },
        (payload) => {
          const next = payload.new as DeliverableRow;
          setDeliverables((prev) => {
            if (prev.find((d) => d.id === next.id)) return prev;
            return [next, ...prev];
          });
        },
      )
      .subscribe(handleStatus("deliverables", setDeliverableState));

    return () => {
      void supabase.removeChannel(stepsChannel);
      void supabase.removeChannel(taskChannel);
      void supabase.removeChannel(deliverableChannel);
    };
  }, [initialTask.id, supabase]);

  // Roll up the three channel states into a single banner state. We only
  // show a banner while the task is still in-flight — once it's terminal
  // (succeeded / failed / cancelled) the realtime channels are advisory
  // and a connection blip is uninteresting.
  const realtimeBanner = (() => {
    if (
      task.status === "succeeded" ||
      task.status === "failed" ||
      task.status === "cancelled"
    ) {
      return null;
    }
    const states = [stepsState, taskState, deliverableState];
    if (states.some((s) => s === "error")) return "error" as const;
    if (states.some((s) => s === "connecting")) return "connecting" as const;
    return null;
  })();

  // ------------------------------------------------------------------
  // Whenever a new deliverable arrives, mint a signed URL for it via
  // a Server Action. We use a Server Action (not browser supabase) so
  // we don't depend on Storage RLS being set up — the action gates by
  // the user's auth and then mints with the service-role client.
  // ------------------------------------------------------------------
  useEffect(() => {
    const todo = deliverables.filter((d) => !mintedRef.current.has(d.id));
    if (todo.length === 0) return;

    let cancelled = false;
    void (async () => {
      const updates: Record<string, string> = {};
      for (const d of todo) {
        mintedRef.current.add(d.id);
        const result = await mintDeliverableUrl(d.id);
        if (result.url) {
          updates[d.id] = result.url;
        }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setSignedUrls((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deliverables]);

  // Collapse step rows so each label shows only once, keeping the most
  // recent status. The worker emits separate "running" / "succeeded"
  // rows for the same label; we want a single line per labelled step.
  const sortedSteps = useMemo(() => {
    const latestByLabel = new Map<string, TaskStepRow>();
    for (const step of steps) {
      const prev = latestByLabel.get(step.label);
      if (!prev || step.idx > prev.idx) {
        latestByLabel.set(step.label, step);
      }
    }
    return [...latestByLabel.values()].sort((a, b) => a.idx - b.idx);
  }, [steps]);

  return (
    <>
      <section className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <div className="flex items-center gap-2">
            <StatusBadge status={task.status} />
            {(task.cost_usd ?? 0) > 0 && (
              <Badge variant="outline" className="tabular-nums">
                ${(task.cost_usd ?? 0).toFixed(2)}
              </Badge>
            )}
            {realtimeBanner === "connecting" && (
              <span className="text-xs text-muted-foreground">
                Connecting to live updates…
              </span>
            )}
            {realtimeBanner === "error" && (
              <span className="text-xs text-amber-600">
                Reconnecting to live updates…
              </span>
            )}
          </div>

          {task.status === "failed" && task.error && (
            <Card className="border-destructive bg-destructive/10">
              <CardContent className="flex gap-3 py-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-destructive">
                    This task failed
                  </p>
                  <p className="break-all text-destructive/80">{task.error}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {task.status === "cancelled" && (
            <Card className="border-muted bg-muted/30">
              <CardContent className="flex gap-3 py-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium">This task was cancelled</p>
                  <p className="text-muted-foreground">
                    No deliverables were produced. Start a new task from the
                    project page if you need fresh results.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {sortedSteps.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Waiting for the worker to record the first step…
                </p>
              ) : (
                <ol className="space-y-4">
                  {sortedSteps.map((step) => (
                    <li
                      key={step.id}
                      className="flex items-start gap-3 text-sm"
                    >
                      <StepIcon status={step.status} />
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className={
                              step.status === "pending"
                                ? "text-muted-foreground"
                                : "text-foreground"
                            }
                          >
                            {step.label}
                          </span>
                          {step.finished_at && step.started_at && (
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {durationLabel(step.started_at, step.finished_at)}
                            </span>
                          )}
                        </div>
                        <PayloadSummary payload={step.payload_json} />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Final report</CardTitle>
          </CardHeader>
          <CardContent>
            {task.status === "succeeded" ? (
              deliverables.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Task succeeded — waiting for deliverables to land…
                </p>
              ) : (
                <div className="space-y-2">
                  {deliverables.map((d) => {
                    const url = signedUrls[d.id];
                    return (
                      <div
                        key={d.id}
                        className="flex items-center justify-between rounded-md border p-3"
                      >
                        <div className="space-y-0.5 text-sm">
                          <div className="font-medium capitalize">
                            {d.kind.replace("_", " ")}
                          </div>
                          {d.expires_at && (
                            <div className="text-xs text-muted-foreground">
                              Expires{" "}
                              {new Date(d.expires_at).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {url ? (
                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                            >
                              <a href={url} target="_blank" rel="noreferrer">
                                <Download className="h-3.5 w-3.5" />
                                Download
                              </a>
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" disabled>
                              Preparing…
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => setShareTarget(d)}
                          >
                            <Share2 className="h-3.5 w-3.5" />
                            Share
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : task.status === "failed" ? (
              <p className="text-sm text-muted-foreground">
                No deliverables — the run failed before producing output.
              </p>
            ) : task.status === "cancelled" ? (
              <p className="text-sm text-muted-foreground">
                No deliverables — the task was cancelled.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                The report appears here once the task completes.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <ShareDialog target={shareTarget} onClose={() => setShareTarget(null)} />
    </>
  );
}

function mergeStep(prev: TaskStepRow[], next: TaskStepRow): TaskStepRow[] {
  const idx = prev.findIndex((s) => s.id === next.id);
  if (idx === -1) return [...prev, next];
  const copy = prev.slice();
  copy[idx] = next;
  return copy;
}
