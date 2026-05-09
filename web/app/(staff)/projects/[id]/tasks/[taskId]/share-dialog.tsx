"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import type { DeliverableRow } from "@/lib/types";

import { shareDeliverable } from "./actions";

interface ShareDialogProps {
  /** Deliverable to share, or `null` to keep the dialog closed. */
  target: DeliverableRow | null;
  /** Called when the dialog should close (cancel, success, or backdrop click). */
  onClose: () => void;
}

/**
 * Email-a-deliverable dialog. Owns its own form state so opening + closing
 * resets cleanly between deliverables. Shows a toast on submit; copies the
 * share URL to the clipboard as a best-effort convenience.
 */
export function ShareDialog({ target, onClose }: ShareDialogProps) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  function reset() {
    setEmail("");
    setMessage("");
  }

  function handleClose() {
    if (pending) return;
    reset();
    onClose();
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!target) return;
    const recipientEmail = email.trim();
    if (!recipientEmail) {
      toast.error("Please enter a recipient email.");
      return;
    }

    setPending(true);
    try {
      const result = await shareDeliverable(target.id, {
        recipientEmail,
        message: message.trim() || undefined,
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
      reset();
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent>
        {target && (
          <form onSubmit={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Share with client</DialogTitle>
              <DialogDescription>
                Send a private link to this {target.kind.replace("_", " ")}.
                We&apos;ll attach the file and copy the link to your clipboard.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="share-email" className="text-sm font-medium">
                  Recipient email
                </label>
                <Input
                  id="share-email"
                  type="email"
                  autoFocus
                  required
                  placeholder="client@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={pending}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="share-message" className="text-sm font-medium">
                  Message{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    (optional)
                  </span>
                </label>
                <Textarea
                  id="share-message"
                  rows={4}
                  placeholder="Hi — here's this month's SEO report. Let me know if you have questions."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={pending}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending} className="gap-1.5">
                {pending ? (
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
  );
}
