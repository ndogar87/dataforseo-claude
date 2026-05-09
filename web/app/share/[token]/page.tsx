import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getServiceClient } from "@/lib/supabase/admin";
import { stripBucketPrefix } from "@/lib/share";

interface ShareViewRow {
  deliverable_id: string;
  deliverable_kind: string;
  storage_path: string;
  expires_at: string | null;
  task_id: string;
  task_type: string;
  task_status: string;
  task_finished_at: string | null;
  project_id: string;
  project_domain: string;
  project_display_name: string;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PublicSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Resolve the token via the security-definer RPC. We deliberately use
  // a fresh anon-key client rather than the cookie-aware server client
  // so the request is unambiguously unauthenticated — the RPC's own
  // expiry check is the only gate, which keeps the surface area small.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const anon = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await anon.rpc("public_share_view", {
    p_token: token,
  });

  if (error || !data || (Array.isArray(data) && data.length === 0)) {
    return <ExpiredOrInvalid />;
  }

  const row = (Array.isArray(data) ? data[0] : data) as ShareViewRow;

  // The token is the auth here — the RPC already enforced expiry — so we
  // can safely sign the storage object with the service-role client.
  const admin = getServiceClient();
  const objectPath = stripBucketPrefix(row.storage_path);
  const { data: signed } = await admin.storage
    .from("deliverables")
    .createSignedUrl(objectPath, 3600);
  const fileUrl = signed?.signedUrl ?? null;

  // Best-effort opened/click tracking. We update the most recent
  // share_event row matching this deliverable. Don't double-count
  // refreshes within 5 minutes — if `opened_at` was set very recently
  // we leave the counter alone. This runs in the background and never
  // blocks the render.
  void recordOpen(admin, row.deliverable_id);

  // For markdown summaries we want to render the content inline. Pull
  // the bytes server-side (the file is small) and pass to the renderer.
  let markdownText: string | null = null;
  if (row.deliverable_kind === "markdown_summary" && fileUrl) {
    try {
      const resp = await fetch(fileUrl, { cache: "no-store" });
      if (resp.ok) markdownText = await resp.text();
    } catch {
      // fall through; the download button still works.
    }
  }

  const finishedAt = row.task_finished_at
    ? new Date(row.task_finished_at)
    : null;
  const taskTypeLabel = row.task_type.replace(/_/g, " ");

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Shared report
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {row.project_display_name}
            </h1>
            <a
              href={`https://${row.project_domain}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-muted-foreground hover:underline"
            >
              {row.project_domain}
            </a>
          </div>
          <Badge variant="outline" className="capitalize">
            {taskTypeLabel}
          </Badge>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-baseline justify-between text-base">
              <span className="font-medium">
                {kindLabel(row.deliverable_kind)}
              </span>
              {finishedAt && (
                <span className="text-xs font-normal text-muted-foreground">
                  Finished {finishedAt.toLocaleDateString()}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DeliverableViewer
              kind={row.deliverable_kind}
              fileUrl={fileUrl}
              markdownText={markdownText}
            />
          </CardContent>
        </Card>

        <Separator />

        <p className="text-center text-xs text-muted-foreground">
          This is a read-only snapshot prepared for{" "}
          <strong>{row.project_display_name}</strong>. Contact your account
          manager for an updated report.
        </p>
      </div>
    </div>
  );
}

function DeliverableViewer({
  kind,
  fileUrl,
  markdownText,
}: {
  kind: string;
  fileUrl: string | null;
  markdownText: string | null;
}) {
  if (!fileUrl) {
    return (
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t prepare the file for viewing. Please try refreshing
        in a moment.
      </p>
    );
  }

  if (kind === "pdf_report") {
    return (
      <div className="space-y-3">
        <iframe
          src={fileUrl}
          className="h-[70vh] w-full rounded-md border"
          title="Report"
        />
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <a href={fileUrl} target="_blank" rel="noreferrer">
              Open in new tab
            </a>
          </Button>
        </div>
      </div>
    );
  }

  if (kind === "markdown_summary") {
    return (
      <div className="space-y-3">
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-md border bg-background p-4 font-sans text-sm leading-relaxed">
          {markdownText ?? "Loading..."}
        </pre>
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <a href={fileUrl} target="_blank" rel="noreferrer" download>
              Download .md
            </a>
          </Button>
        </div>
      </div>
    );
  }

  if (kind === "csv_keywords") {
    return (
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Keyword data is available as a CSV file.
        </p>
        <Button asChild>
          <a href={fileUrl} target="_blank" rel="noreferrer" download>
            Download CSV
          </a>
        </Button>
      </div>
    );
  }

  // json_audit + future kinds: offer a generic download.
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-muted-foreground">
        This deliverable is available for download.
      </p>
      <Button asChild>
        <a href={fileUrl} target="_blank" rel="noreferrer" download>
          Download file
        </a>
      </Button>
    </div>
  );
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "pdf_report":
      return "PDF report";
    case "json_audit":
      return "Audit JSON";
    case "csv_keywords":
      return "Keyword export";
    case "markdown_summary":
      return "Summary";
    default:
      return kind.replace(/_/g, " ");
  }
}

function ExpiredOrInvalid() {
  return (
    <div className="min-h-screen bg-muted/30 px-4 py-24">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Link unavailable
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This share link is invalid or has expired. Contact the person who
          sent it for an updated link.
        </p>
      </div>
    </div>
  );
}

/**
 * Update the latest share_event for this deliverable to reflect that
 * the link was opened. We use service-role here because share_events
 * is RLS-locked to workspace members and the public viewer is
 * unauthenticated. Best-effort: any error is swallowed so a metrics
 * blip never breaks the page.
 */
async function recordOpen(
  admin: ReturnType<typeof getServiceClient>,
  deliverableId: string,
): Promise<void> {
  try {
    const { data: events } = await admin
      .from("share_events")
      .select("id, opened_at, click_count")
      .eq("deliverable_id", deliverableId)
      .order("sent_at", { ascending: false })
      .limit(1);

    const row = events?.[0] as
      | { id: string; opened_at: string | null; click_count: number }
      | undefined;
    if (!row) return;

    // Debounce repeated refreshes within 5 minutes — keeps click_count
    // honest without needing per-IP cookies.
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const lastOpened = row.opened_at ? new Date(row.opened_at).getTime() : 0;
    if (lastOpened > fiveMinAgo) return;

    await admin
      .from("share_events")
      .update({
        opened_at: row.opened_at ?? new Date().toISOString(),
        click_count: (row.click_count ?? 0) + 1,
      })
      .eq("id", row.id);
  } catch {
    // Intentionally silent.
  }
}
