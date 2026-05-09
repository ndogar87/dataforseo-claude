// Shared cross-cutting types for the staff app. Mirrors the schema in
// `web/db/migrations/0001_init.sql`.

export type TaskType =
  | "audit"
  | "quick"
  | "keywords"
  | "technical"
  | "backlinks"
  | "rankings"
  | "content_gap"
  | "report_pdf";

export type TaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type StepStatus = "pending" | "running" | "succeeded" | "failed";

export type DeliverableKind =
  | "pdf_report"
  | "json_audit"
  | "csv_keywords"
  | "markdown_summary";

export interface TaskRow {
  id: string;
  project_id: string;
  type: TaskType;
  status: TaskStatus;
  params_json: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  cost_usd: number;
  error: string | null;
}

export interface TaskStepRow {
  id: string;
  task_id: string;
  idx: number;
  label: string;
  status: StepStatus;
  payload_json: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
}

export interface DeliverableRow {
  id: string;
  task_id: string;
  kind: DeliverableKind;
  storage_path: string;
  public_token: string | null;
  expires_at: string | null;
  created_at: string;
}
