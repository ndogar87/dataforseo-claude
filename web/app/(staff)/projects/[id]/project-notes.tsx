"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { saveProjectNotes } from "./notes-actions";

export function ProjectNotes({
  projectId,
  initialValue,
}: {
  projectId: string;
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  // Track the last value we successfully persisted so the dirty check
  // is correct even after multiple saves in the same session.
  const [savedValue, setSavedValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const dirty = value !== savedValue;

  async function onSave() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const result = await saveProjectNotes(projectId, value);
      if (!result.ok) {
        toast.error("Couldn't save notes", { description: result.error });
        return;
      }
      setSavedValue(value);
      toast.success("Notes saved");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Couldn't save notes", { description: message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Internal notes — markdown supported."
        className="min-h-[140px] font-mono text-xs"
        aria-label={`Notes for project ${projectId}`}
        disabled={saving}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={!dirty || saving}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save notes"}
        </Button>
      </div>
    </div>
  );
}
