"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TASK_BUTTONS } from "@/lib/mock-data";
import type { TaskType } from "@/lib/types";

import { runTask } from "./actions";

// Tasks that need extra params from the user before we can dispatch.
type PromptKind = "keywords" | "rankings" | "content_gap";

const PROMPTS: Record<
  PromptKind,
  { title: string; description: string; placeholder: string; field: string }
> = {
  keywords: {
    title: "Keyword research",
    description:
      "Enter a seed keyword to expand into clusters and SERP intent.",
    placeholder: "e.g. running shoes",
    field: "seed",
  },
  rankings: {
    title: "Track rankings",
    description: "Comma-separated keywords to check current SERP positions for.",
    placeholder: "shoes, running shoes, marathon shoes",
    field: "keywords",
  },
  content_gap: {
    title: "Content gap analysis",
    description: "Competitor domain to compare against your project's domain.",
    placeholder: "competitor.com",
    field: "competitor_domain",
  },
};

function isPromptKind(t: TaskType): t is PromptKind {
  return t === "keywords" || t === "rankings" || t === "content_gap";
}

export function TaskButtons({
  projectId,
  domain,
}: {
  projectId: string;
  domain: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<TaskType | null>(null);
  const [promptOpen, setPromptOpen] = useState<PromptKind | null>(null);
  const [promptValue, setPromptValue] = useState("");

  async function dispatch(type: TaskType, extraParams: Record<string, unknown>) {
    setPending(type);
    try {
      const params: Record<string, unknown> = { domain, ...extraParams };
      const result = await runTask(projectId, type, params);
      router.push(`/projects/${projectId}/tasks/${result.taskId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Failed to start task", { description: message });
      setPending(null);
    }
  }

  function onClick(type: TaskType) {
    if (pending) return;
    if (isPromptKind(type)) {
      setPromptValue("");
      setPromptOpen(type);
      return;
    }
    void dispatch(type, {});
  }

  function onPromptSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!promptOpen) return;
    const trimmed = promptValue.trim();
    if (!trimmed) {
      toast.error("Please enter a value before continuing.");
      return;
    }
    const config = PROMPTS[promptOpen];
    const params: Record<string, unknown> =
      promptOpen === "rankings"
        ? {
            keywords: trimmed
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean),
          }
        : { [config.field]: trimmed };
    const type = promptOpen;
    setPromptOpen(null);
    void dispatch(type, params);
  }

  const activePrompt = promptOpen ? PROMPTS[promptOpen] : null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {TASK_BUTTONS.map(({ type, label, hint }) => {
          const isPending = pending === type;
          const disabled = pending !== null;
          return (
            <Button
              key={type}
              variant="outline"
              className="flex h-auto flex-col items-start gap-1 px-4 py-3 text-left"
              disabled={disabled}
              onClick={() => onClick(type)}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isPending ? "Starting…" : label}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {hint}
              </span>
            </Button>
          );
        })}
      </div>

      <Dialog
        open={promptOpen !== null}
        onOpenChange={(open) => {
          if (!open) setPromptOpen(null);
        }}
      >
        <DialogContent>
          {activePrompt && (
            <form onSubmit={onPromptSubmit} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{activePrompt.title}</DialogTitle>
                <DialogDescription>
                  {activePrompt.description}
                </DialogDescription>
              </DialogHeader>
              <Input
                autoFocus
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                placeholder={activePrompt.placeholder}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPromptOpen(null)}
                >
                  Cancel
                </Button>
                <Button type="submit">Run</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
