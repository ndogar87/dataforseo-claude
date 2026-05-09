"use client";

import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { StepStatus, TaskStatus } from "@/lib/types";

/**
 * Visual primitives shared by the task timeline view: the per-step icon,
 * the task status badge, and the compact payload summary line.
 *
 * Kept out of `task-timeline.tsx` so that file can stay focused on
 * Realtime subscriptions, share-dialog state, and signed-URL minting.
 */

export function StatusBadge({ status }: { status: TaskStatus }) {
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

export function StepIcon({ status }: { status: StepStatus }) {
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

export function PayloadSummary({
  payload,
}: {
  payload: Record<string, unknown>;
}) {
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

export function durationLabel(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
