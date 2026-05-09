"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { createProject } from "./actions";

interface NewProjectDialogProps {
  /**
   * Optional override for the trigger button. Defaults to a primary
   * "New project" button. Use `variant="outline"` etc. by passing a
   * custom child if the empty state needs a different look.
   */
  triggerLabel?: string;
  /** Tailwind classes forwarded to the trigger button. */
  triggerClassName?: string;
}

export function NewProjectDialog({
  triggerLabel = "New project",
  triggerClassName,
}: NewProjectDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setDomain("");
    setDisplayName("");
    setSubmitting(false);
  }

  function onOpenChange(next: boolean) {
    if (submitting) return; // don't let users close mid-submit
    setOpen(next);
    if (!next) reset();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    const trimmedDomain = domain.trim();
    const trimmedName = displayName.trim();
    if (!trimmedDomain) {
      toast.error("Please enter a domain.");
      return;
    }
    if (!trimmedName) {
      toast.error("Please enter a display name.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await createProject({
        domain: trimmedDomain,
        displayName: trimmedName,
      });
      if (!result.ok) {
        toast.error("Couldn't create project", { description: result.error });
        setSubmitting(false);
        return;
      }
      toast.success("Project created");
      // Close before navigating so the dialog teardown doesn't fight
      // the route transition.
      setOpen(false);
      router.push(`/projects/${result.projectId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Couldn't create project", { description: message });
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className={triggerClassName}>
          <Plus className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Add a client domain to start running SEO tasks against it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="new-project-domain" className="text-sm font-medium">
              Domain
            </label>
            <Input
              id="new-project-domain"
              autoFocus
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="example.com"
              autoComplete="off"
              spellCheck={false}
              disabled={submitting}
              required
            />
            <p className="text-xs text-muted-foreground">
              We&apos;ll strip the protocol and leading www. for you.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="new-project-name" className="text-sm font-medium">
              Display name
            </label>
            <Input
              id="new-project-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Example Co."
              autoComplete="off"
              disabled={submitting}
              required
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
