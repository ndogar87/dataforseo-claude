"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  CircleDashed,
  Download,
  Loader2,
  Send,
  Share2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type {
  DeliverableRow,
  StepStatus,
  TaskRow,
  TaskStepRow,
  TaskStatus,
} from "@/lib/types";

import { mintDeliverableUrl, shareDeliverable } from "./actions";

interface TaskTimelineProps {
  initialTask: TaskRow;
  initialSteps: TaskStepRow[];
  initialDeliverables: DeliverableRow[];
  initialSignedUrls: Record<string, string>;
  projectId: string;
}

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

  // Track which deliverables we've already minted URLs for client-side
  // so we don't spam Storage on every re-render.
  const mintedRef = useRef<Set<string>>(new Set(Object.keys(initialSignedUrls)));

  // ------------------------------------------------------------------
  // Share dialog state. We model it as a single open-or-null pointer
  // so only one dialog can be active at a time and the form fields
  // reset cleanly between deliverables.
  // ------------------------------------------------------------------
  const [shareTarget, setShareTarget] = useState<DeliverableRow | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [sharePending, setSharePending] = useState(false);

  function openShareDialog(deliverable: DeliverableRow) {
    setShareTarget(deliverable);
    setShareEmail("");
    setShareMessage("");
  }

  function closeShareDialog() {
    if (sharePending) return;
    setShareTarget(null);
  }

  async function onShareSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!shareTarget) return;
    const recipientEmail = shareEmail.trim();
    if (!recipientEmail) {
      toast.error("Please enter a recipient email.");
      return;
    }

    setSharePending(true);
    try {
      const result = await shareDeliverable(shareTarget.id, {
        recipientEmail,
        message: shareMessage.trim() || undefined,
      });

      if (!result.ok) {
        toast.error("Could not share", { description: result.error });
        return;
      }

      // Best-effort copy to clipboard. Browsers gate this on a secure
      // context + user gesture; the form submit itself counts as the
      // gesture so it works in dev (localhost) and prod (https).
      try {
        await navigator.clipboard.writeText(result.shareUrl);
      } catch {
        // Non-fatal — the user still has the toast confirming success.
      }

      if ("warning" in result && result.warning) {
        toast.warning("Link copied — email did not send", {
          description: result.warning,
        });
      } else {
        toast.success("Sent! Link copied.");
      }
      setShareTarget(null);
    } finally {
      setSharePending(false);
    }
  }

  // ------------------------------------------------------------------
  // Realtime subscriptions: task_steps + tasks + deliverables, all
  // filtered down to this single task row.
  // ------------------------------------------------------------------
  useEffect(() => {
    const taskId = initialTask.id;

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
      .subscribe();

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
      .subscribe();

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
      .subscribe();

    return () => {
      void supabase.removeChannel(stepsChannel);
      void supabase.removeChannel(taskChannel);
      void supabase.removeChannel(deliverableChannel);
    };
  }, [initialTask.id, supabase]);

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
          {task.cost_usd > 0 && (
            <Badge variant="outline" className="tabular-nums">
              ${task.cost_usd.toFixed(2)}
            </Badge>
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
                          onClick={() => openShareDialog(d)}
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
          ) : (
            <p className="text-sm text-muted-foreground">
              The report appears here once the task completes.
            </p>
          )}
        </CardContent>
      </Card>
    </section>

      <Dialog
        open={shareTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeShareDialog();
        }}
      >
        <DialogContent>
          {shareTarget && (
            <form onSubmit={onShareSubmit} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Share with client</DialogTitle>
                <DialogDescription>
                  Send a private link to this {shareTarget.kind.replace("_", " ")}.
                  We&apos;ll attach the file and copy the link to your clipboard.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="share-email"
                    className="text-sm font-medium"
                  >
                    Recipient email
                  </label>
                  <Input
                    id="share-email"
                    type="email"
                    autoFocus
                    required
                    placeholder="client@example.com"
                    value={shareEmail}
                    onChange={(e) => setShareEmail(e.target.value)}
                    disabled={sharePending}
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="share-message"
                    className="text-sm font-medium"
                  >
                    Message{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </label>
                  <Textarea
                    id="share-message"
                    rows={4}
                    placeholder="Hi — here's this month's SEO report. Let me know if you have questions."
                    value={shareMessage}
                    onChange={(e) => setShareMessage(e.target.value)}
                    disabled={sharePending}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShareTarget(null)}
                  disabled={sharePending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={sharePending} className="gap-1.5">
                  {sharePending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Send & copy link
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
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

function StatusBadge({ status }: { status: TaskStatus }) {
  const variant =
    status === "succeeded"
      ? "success"
      : status === "running"
        ? "default"
        : status === "failed"
          ? "destructive"
          : status === "queued"
            ? "secondary"
            : "outline";
  return (
    <Badge
      variant={variant as React.ComponentProps<typeof Badge>["variant"]}
      className="capitalize"
    >
      {status}
    </Badge>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "succeeded":
      return <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />;
    case "running":
      return (
        <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-foreground" />
      );
    case "failed":
      return <XCircle className="mt-0.5 h-4 w-4 text-destructive" />;
    case "pending":
    default:
      return <CircleDashed className="mt-0.5 h-4 w-4 text-muted-foreground" />;
  }
}

function PayloadSummary({ payload }: { payload: Record<string, unknown> }) {
  if (!payload || typeof payload !== "object") return null;
  const entries = Object.entries(payload).filter(
    ([key]) => key !== "trace" && key !== "label",
  );
  if (entries.length === 0) return null;

  // Compact one-line summary, capped to keep the timeline tidy.
  const summary = entries
    .slice(0, 4)
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(" · ");

  return (
    <p className="mt-1 break-all text-xs text-muted-foreground">{summary}</p>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    return v.length > 60 ? `${v.slice(0, 60)}…` : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const json = JSON.stringify(v);
    return json.length > 60 ? `${json.slice(0, 60)}…` : json;
  } catch {
    return String(v);
  }
}

function durationLabel(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function stripBucketPrefix(storagePath: string): string {
  const prefix = "deliverables/";
  return storagePath.startsWith(prefix)
    ? storagePath.slice(prefix.length)
    : storagePath;
}

// Suppress unused-import warning if Circle ends up unused in some refactors.
void Circle;
