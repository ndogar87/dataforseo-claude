"use server";

import path from "path";
import { Resend } from "resend";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { getServiceClient, insertRow, updateRow } from "@/lib/supabase/admin";
import {
  buildShareUrl,
  defaultExpiry,
  mintShareToken,
  tokenIsFresh,
} from "@/lib/share";
import { stripBucketPrefix } from "@/lib/storage";

/**
 * Mint a 1-hour signed URL for a deliverable. Uses the service-role
 * client so we don't depend on Storage RLS being configured for the
 * deliverables bucket. We still gate access by RLS on the deliverables
 * row (read via the auth-aware client) so a logged-in user can only
 * mint URLs for tasks in workspaces they belong to.
 */
export async function mintDeliverableUrl(
  deliverableId: string,
): Promise<{ url: string | null; error?: string }> {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { url: null, error: "Not authenticated" };

  // RLS on `deliverables` joins through tasks → projects → workspace_members,
  // so this read confirms the user has access before we mint anything.
  const { data, error } = await supabase
    .from("deliverables")
    .select("id, task_id, storage_path")
    .eq("id", deliverableId)
    .maybeSingle();

  if (error || !data) {
    return { url: null, error: "Deliverable not found or access denied" };
  }

  const row = data as { id: string; task_id: string; storage_path: string };

  const objectPath = stripBucketPrefix(row.storage_path);
  const admin = getServiceClient();
  const { data: signed, error: signErr } = await admin.storage
    .from("deliverables")
    .createSignedUrl(objectPath, 3600);

  if (signErr || !signed?.signedUrl) {
    return { url: null, error: signErr?.message ?? "Failed to mint URL" };
  }

  return { url: signed.signedUrl };
}

interface ShareInput {
  recipientEmail: string;
  message?: string;
}

interface ShareDeliverableSuccess {
  ok: true;
  shareUrl: string;
  warning?: string;
}

interface ShareDeliverableFailure {
  ok: false;
  error: string;
}

/**
 * Share a deliverable with a client by email.
 *
 * Flow:
 *   1. Verify the user is signed in and (via RLS) can read the deliverable.
 *   2. Reuse the existing share token if it has at least 7 days of life
 *      left, otherwise rotate to a fresh 32-byte token with a 30-day TTL.
 *   3. Sign the storage object for 1 hour, fetch the bytes, and send the
 *      file as an attachment via Resend along with the share URL.
 *   4. Insert a `share_events` row so we can show open / click metrics
 *      later.
 *
 * Resend on the free tier requires a verified sender domain. If the
 * email send fails we still mint the token and create the share_events
 * row — the staff user can copy the link manually — and we surface a
 * `warning` so the UI can flag it.
 */
export async function shareDeliverable(
  deliverableId: string,
  input: ShareInput,
): Promise<ShareDeliverableSuccess | ShareDeliverableFailure> {
  try {
    const recipientEmail = input.recipientEmail.trim();
    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return { ok: false, error: "Please enter a valid email address." };
    }

    const supabase = await createServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated" };

    // RLS-gated read confirms the user belongs to the owning workspace
    // and gives us the parent task + project for the email subject line.
    const { data: deliverableData, error: deliverableErr } = await supabase
      .from("deliverables")
      .select(
        `id,
         task_id,
         kind,
         storage_path,
         public_token,
         expires_at,
         tasks:task_id (
           id,
           project_id,
           projects:project_id ( id, domain, display_name )
         )`,
      )
      .eq("id", deliverableId)
      .maybeSingle();

    if (deliverableErr || !deliverableData) {
      return { ok: false, error: "Deliverable not found or access denied" };
    }

    // Supabase returns the `tasks` join as an object when the relationship
    // is a single FK, but the JS client types it as `unknown[]` — narrow
    // explicitly here so the email subject is always sensible.
    const tasksJoin = (deliverableData as { tasks?: unknown }).tasks as
      | {
          projects?: { domain?: string; display_name?: string } | null;
        }
      | Array<{
          projects?: { domain?: string; display_name?: string } | null;
        }>
      | null
      | undefined;
    const taskRow = Array.isArray(tasksJoin) ? tasksJoin[0] : tasksJoin;
    const projectRow = Array.isArray(taskRow?.projects)
      ? taskRow?.projects[0]
      : taskRow?.projects;
    const projectDomain =
      projectRow?.domain ?? projectRow?.display_name ?? "your site";

    const existingToken = (deliverableData as { public_token: string | null })
      .public_token;
    const existingExpiry = (deliverableData as { expires_at: string | null })
      .expires_at;
    const storagePath = (deliverableData as { storage_path: string })
      .storage_path;

    // Decide whether to reuse the existing token or rotate. We rotate
    // proactively (instead of right at expiry) so a freshly-shared link
    // always has a comfortable lifetime ahead of it.
    const admin = getServiceClient();
    let token = existingToken;
    if (!token || !tokenIsFresh(existingExpiry)) {
      token = mintShareToken();
      const { error: updateErr } = await updateRow(admin, "deliverables", {
        public_token: token,
        expires_at: defaultExpiry(),
      }).eq("id", deliverableId);
      if (updateErr) {
        return {
          ok: false,
          error: `Could not mint share token: ${updateErr.message}`,
        };
      }
    }

    const shareUrl = buildShareUrl(token);

    // Sign the file, fetch it, attach to the email. 1 hour is plenty of
    // time for Resend to pull the bytes — we do this server-side because
    // Resend needs the actual content; it won't follow signed URLs.
    const objectPath = stripBucketPrefix(storagePath);
    const { data: signed, error: signErr } = await admin.storage
      .from("deliverables")
      .createSignedUrl(objectPath, 3600);
    if (signErr || !signed?.signedUrl) {
      return {
        ok: false,
        error: signErr?.message ?? "Could not sign deliverable for email.",
      };
    }

    const fileResp = await fetch(signed.signedUrl);
    if (!fileResp.ok) {
      return {
        ok: false,
        error: `Could not fetch deliverable for attachment (${fileResp.status}).`,
      };
    }
    const fileBytes = Buffer.from(await fileResp.arrayBuffer());
    const filename = path.basename(storagePath) || "report";

    // Always log the share attempt before the email — so the deliverable
    // is shareable even if SMTP is misconfigured.
    const { error: shareEventErr } = await insertRow(admin, "share_events", {
      deliverable_id: deliverableId,
      recipient_email: recipientEmail,
      sent_at: new Date().toISOString(),
    });
    if (shareEventErr) {
      // Non-fatal; log but continue. The token + link are still valid.
      console.error(
        "[shareDeliverable] share_events insert failed",
        shareEventErr,
      );
    }

    let warning: string | undefined;
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      warning =
        "Email did not send: RESEND_API_KEY is not configured. The link is still valid.";
    } else {
      try {
        const resend = new Resend(apiKey);
        const fromAddress =
          process.env.RESEND_FROM ?? "reports@yourseoagency.com";
        const messageHtml = renderEmailHtml({
          shareUrl,
          message: input.message?.trim() || undefined,
          projectDomain,
        });
        const messageText = renderEmailText({
          shareUrl,
          message: input.message?.trim() || undefined,
          projectDomain,
        });

        const { error: sendErr } = await resend.emails.send({
          from: fromAddress,
          to: recipientEmail,
          subject: `Your SEO report — ${projectDomain}`,
          html: messageHtml,
          text: messageText,
          attachments: [
            {
              filename,
              content: fileBytes,
            },
          ],
        });
        if (sendErr) {
          warning = `Email did not send: ${sendErr.message ?? "Resend rejected the request."}`;
          console.error("[shareDeliverable] Resend send failed", sendErr);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warning = `Email did not send: ${msg}`;
        console.error("[shareDeliverable] Resend threw", err);
      }
    }

    return warning ? { ok: true, shareUrl, warning } : { ok: true, shareUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[shareDeliverable] unexpected error", err);
    return { ok: false, error: msg };
  }
}

interface EmailParts {
  shareUrl: string;
  message?: string;
  projectDomain: string;
}

function renderEmailHtml({
  shareUrl,
  message,
  projectDomain,
}: EmailParts): string {
  const safeMessage = message ? escapeHtml(message) : "";
  const safeUrl = escapeHtml(shareUrl);
  const safeDomain = escapeHtml(projectDomain);
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111; line-height: 1.5; max-width: 560px; margin: 0 auto; padding: 24px;">
    <p>Hi,</p>
    <p>Your SEO report for <strong>${safeDomain}</strong> is ready.</p>
    ${safeMessage ? `<p style="white-space: pre-wrap; padding: 12px 16px; background: #f6f6f6; border-radius: 6px;">${safeMessage}</p>` : ""}
    <p>You can view it online at:</p>
    <p><a href="${safeUrl}" style="color: #2563eb;">${safeUrl}</a></p>
    <p>The full report is also attached as a file.</p>
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">This link is read-only and will expire in 30 days.</p>
  </body>
</html>`;
}

function renderEmailText({
  shareUrl,
  message,
  projectDomain,
}: EmailParts): string {
  const lines = [
    `Hi,`,
    ``,
    `Your SEO report for ${projectDomain} is ready.`,
    ``,
  ];
  if (message) {
    lines.push(message, "");
  }
  lines.push(
    `View online: ${shareUrl}`,
    ``,
    `The full report is also attached as a file.`,
    ``,
    `This link is read-only and will expire in 30 days.`,
  );
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
