// Static button configuration for the project-detail "Run a task" panel.
// Lives next to the cross-cutting type definitions in `./types.ts`.

import type { TaskType } from "./types";

export const TASK_BUTTONS: { type: TaskType; label: string; hint: string }[] = [
  { type: "audit", label: "Full audit", hint: "Composite SEO score" },
  { type: "quick", label: "Quick scan", hint: "60s overview" },
  { type: "keywords", label: "Keywords", hint: "Research + clusters" },
  { type: "technical", label: "Technical", hint: "On-page + crawl" },
  { type: "backlinks", label: "Backlinks", hint: "Refdomains + anchors" },
  { type: "rankings", label: "Rankings", hint: "SERP positions" },
  { type: "content_gap", label: "Content gap", hint: "vs. competitors" },
  { type: "report_pdf", label: "Report PDF", hint: "Client deliverable" },
];
