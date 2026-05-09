import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware. Two jobs:
 *
 *   1. Apply baseline security headers to every response (CSP, HSTS,
 *      Referrer-Policy, X-Content-Type-Options, X-Frame-Options).
 *   2. Throttle abusive traffic against the public `/share/<token>`
 *      surface so a leaked-or-guessed token can't be enumerated by a
 *      single-IP bot.
 *
 * The throttle is a tiny in-memory token bucket. It survives only as
 * long as the Edge function instance — fine for a basic abuse brake,
 * NOT a real rate-limiter. For real production protection, swap the
 * bucket for an Upstash / Redis check (TODO marked below). We keep the
 * in-memory variant so dev + Vercel preview work without extra infra.
 */

// Tunables — generous enough that legitimate human traffic never trips
// them, tight enough to detect a script.
const SHARE_RATE_LIMIT_PER_MIN = 30;
const SHARE_RATE_WINDOW_MS = 60_000;

interface BucketEntry {
  count: number;
  resetAt: number;
}

// One bucket per IP. Keys are evicted lazily; the map is bounded by the
// number of unique IPs hitting a single Edge instance per minute, which
// is small. If this ever balloons we'll move to Upstash.
const SHARE_BUCKETS: Map<string, BucketEntry> = new Map();

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  // NextRequest no longer exposes `.ip` reliably; fall back to a
  // hostname so we still bucket *something*. This is intentionally
  // weaker than IP-keyed throttling.
  return "unknown";
}

function shareIsRateLimited(ip: string): boolean {
  const now = Date.now();
  const existing = SHARE_BUCKETS.get(ip);
  if (!existing || now >= existing.resetAt) {
    SHARE_BUCKETS.set(ip, { count: 1, resetAt: now + SHARE_RATE_WINDOW_MS });
    return false;
  }
  existing.count += 1;
  if (existing.count > SHARE_RATE_LIMIT_PER_MIN) {
    return true;
  }
  return false;
}

function setSecurityHeaders(res: NextResponse, isShare: boolean): void {
  // HSTS: production-only — sending it from localhost is harmless but
  // some browsers cache it for the dev hostname which is annoying.
  if (process.env.NODE_ENV === "production") {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-DNS-Prefetch-Control", "off");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );

  // Public share pages embed PDFs in same-origin iframes — they need
  // SAMEORIGIN. Everywhere else, deny framing entirely to defang
  // clickjacking.
  res.headers.set("X-Frame-Options", isShare ? "SAMEORIGIN" : "DENY");

  // CSP: lenient (Supabase Realtime needs ws:/wss:, Storage needs the
  // project subdomain, signed URLs land on supabase.co, Resend never
  // reaches the browser). We keep it report-friendly rather than
  // strict so Realtime + signed-URL downloads don't break. Tighten
  // once we have nonce plumbing.
  const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: blob: https:",
    // Inline + eval are required by Next/React in dev; in prod we still
    // need 'unsafe-inline' for streaming + style attrs. We keep this
    // permissive on purpose; revisit when CSP nonces are plumbed.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseHost} ${supabaseHost.replace(/^https?:\/\//, "wss://")} https://*.supabase.co wss://*.supabase.co`,
    "frame-src 'self' blob: https://*.supabase.co",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
  res.headers.set("Content-Security-Policy", csp);
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const isShare = pathname.startsWith("/share/");

  if (isShare) {
    const ip = clientIp(req);
    if (shareIsRateLimited(ip)) {
      // Log the abuse without echoing the token.
      console.warn("[share] rate-limited", { ip, path: pathname });
      const blocked = new NextResponse(
        "Too many requests. Try again in a minute.",
        { status: 429 },
      );
      blocked.headers.set("Retry-After", "60");
      setSecurityHeaders(blocked, true);
      return blocked;
    }
  }

  // TODO (Phase 2): swap the in-memory bucket above for an Upstash
  // Redis check so the throttle survives across Edge instances and a
  // multi-region deployment. Keep the same threshold + window.

  const res = NextResponse.next();
  setSecurityHeaders(res, isShare);
  return res;
}

// Apply to every route except Next internals + static assets — we want
// security headers on `/share/*`, on the staff pages, and on the API.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)",
  ],
};
