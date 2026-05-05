---
name: seo
description: >
  Full SEO toolkit for Claude Code, powered by the DataForSEO API. Replaces the
  data layer of an SEO agency: keyword research, competitor analysis, rank
  tracking, backlink audits, technical site crawls, content gap analysis, and
  client-ready PDF reports — all with real Google search data, not scraping.
  Use when the user says "seo", "keyword research", "rank check", "backlinks",
  "competitor analysis", "site audit", "content gap", "compare domains", or
  passes a domain / URL / keyword for SEO analysis.
allowed-tools: Read, Grep, Glob, Bash, WebFetch, Write, Agent
---

# SEO Agency Killer — Claude Code Skill (April 2026)

> **Philosophy:** One command in, real Google data out. No browsing, no scraping,
> no guesswork — every metric below comes straight from DataForSEO's live APIs.

---

## Phase 0: First-Run Setup Check (MANDATORY — run before ANY command)

Before doing **anything** with a `/seo ...` request, run this check. Do not
skip it, even if the user just wants a quick command.

**Step 1 — Read the credentials file:**

```bash
cat ~/.claude/skills/seo/.env 2>/dev/null
```

**Step 2 — Decide if credentials are configured:**

The `.env` is **NOT configured** if any of these are true:
- The file doesn't exist
- `DATAFORSEO_LOGIN` is missing or contains the literal string `your_login_email_here`
- `DATAFORSEO_PASSWORD` is missing or contains the literal string `your_api_password_here`

**Step 3a — If credentials ARE configured:** continue to the requested command, no message needed.

**Step 3b — If credentials are NOT configured:** STOP. Do not run the requested command.
Instead, paste exactly this setup wizard to the user:

```
🔧 DataForSEO API Setup Required

This skill needs DataForSEO API credentials to fetch real Google SEO data.
One-time setup, takes 60 seconds:

  Step 1 — Sign up free (includes $1 trial credit, ~10 full audits):
           https://app.dataforseo.com/register

  Step 2 — After verifying your email, open API Access:
           https://app.dataforseo.com/api-access

  Step 3 — Copy your API Login (your email) and API Password
           (the long alphanumeric string under "API password")

  Step 4 — Paste both back to me in this exact format:

           login: your_email@example.com
           password: 1adc9025dc1a3e86

I'll save them securely to ~/.claude/skills/seo/.env (chmod 600) and run
your original command immediately after.
```

Then **WAIT** for the user's reply with credentials.

**Step 4 — When the user pastes credentials:**

1. Parse `login:` and `password:` from their message (handle `Login:`, `Password:`,
   email-only, or just two lines as well — be lenient)
2. Write them to `~/.claude/skills/seo/.env` using this format:

```
DATAFORSEO_LOGIN=<their_login>
DATAFORSEO_PASSWORD=<their_password>
```

3. Lock down permissions:

```bash
chmod 600 ~/.claude/skills/seo/.env
```

4. Run a verification call (cheap — ~$0.001):

```bash
~/.claude/skills/seo/scripts/keyword_research.py volume "test" 2>&1
```

5. Interpret the result:

| Result | Tell the user |
|--------|---------------|
| Real JSON with search volume | ✅ `Credentials verified. Running your audit now...` then run the original command |
| Status `40104 — Please verify your account` | ⚠️ `Credentials work but DataForSEO needs you to verify your account first. Visit https://app.dataforseo.com/ and complete verification (usually email click + payment method on file). Then say "continue" and I'll retry.` |
| HTTP 401 or 403 (not 40104) | 🔴 `Those credentials didn't work. Common fix: make sure you copied the API password (long alphanumeric string from https://app.dataforseo.com/api-access), not your account login password.` |
| Anything else | Show the raw error, suggest the user paste it back so we can debug |

**Important:** Never echo the credentials back to the user, never include them
in any tool output, and never commit them to git.

---

## Quick Reference

| Command | What It Does |
|---------|-------------|
| `/seo audit <domain>` | Full SEO audit with parallel subagents → composite SEO Score (0-100) + PDF |
| `/seo quick <domain>` | 60-second snapshot — top metrics, no subagents |
| `/seo keywords <seed>` | Keyword research (volume, CPC, difficulty, intent, related, long-tail) |
| `/seo technical <domain>` | Technical site audit (On-Page API: speed, schema, errors, redirects) |
| `/seo competitors <domain>` | Find competitors, get SERP overlap, content gap |
| `/seo content <domain>` | Content quality + topical authority + missing topics |
| `/seo backlinks <domain>` | Backlink profile, top referring domains, anchor text, toxicity |
| `/seo rankings <domain> <keywords...>` | On-demand rank check across keyword set |
| `/seo content-gap <you> <competitor>` | Keywords competitors rank for that you don't |
| `/seo compare <domain1> <domain2>` | Head-to-head domain comparison |
| `/seo watchlist add/list/check` | Track multiple domains/keywords across runs |
| `/seo report <domain>` | Markdown deliverable |
| `/seo report-pdf <domain>` | Client-ready PDF report from saved audit JSON |

---

## Setup

1. Sign up at https://app.dataforseo.com/register (free trial includes $1 credit).
2. Add credentials to `~/.claude/skills/seo/.env`:

```
DATAFORSEO_LOGIN=your_login_email
DATAFORSEO_PASSWORD=your_api_password
```

The installer creates this file from `.env.example` and the shared client at
[scripts/dataforseo_client.py](scripts/dataforseo_client.py) reads it.

---

## How To Run Each Command

All scripts below live at `~/.claude/skills/seo/scripts/` and have shebangs
pinned to the skill's isolated venv. Call them directly — no `python3` prefix.

### `/seo quick <domain>`

A 60-second snapshot. Run these three calls in parallel and synthesize:

```bash
~/.claude/skills/seo/scripts/domain_overview.py overview --target <domain>
~/.claude/skills/seo/scripts/backlinks.py summary --target <domain>
~/.claude/skills/seo/scripts/domain_overview.py ranked --target <domain> --limit 25
```

Produce a 5-line summary: estimated organic traffic, total keywords ranking,
backlink count, top 5 keywords by volume, and one headline opportunity.

### `/seo audit <domain>` — Full Audit (Parallel Subagents)

Delegate to the five specialist subagents **in parallel** using the Agent tool:

| Subagent | What it produces |
|----------|------------------|
| `seo-keywords` | Keyword Score + top opportunities |
| `seo-technical` | Technical Score + crawl issues |
| `seo-competitors` | Competitive Score + top 10 competitors + SERP overlap |
| `seo-content` | Content Score + content gap topics |
| `seo-backlinks` | Authority Score + backlink profile + toxicity flags |

Each subagent calls the appropriate scripts, summarizes findings, and returns
a structured block. Then:

1. Compute the **composite SEO Score** as a weighted average:
   `overall = 0.25*keywords + 0.25*technical + 0.20*competitors + 0.15*content + 0.15*authority`
2. Build an audit JSON object matching `schema/audit_input.example.json`.
3. Write it to `~/.claude/skills/seo/output/<domain>-audit.json`.
4. Offer to generate the PDF: `/seo report-pdf <domain>`.

### `/seo keywords <seed>`

```bash
~/.claude/skills/seo/scripts/keyword_research.py related "<seed>" --limit 200
~/.claude/skills/seo/scripts/keyword_research.py suggestions "<seed>" --limit 100
```

Group results by intent (informational, commercial, transactional, navigational).
Surface the **20 best opportunities** ranked by `volume / (difficulty + 1)`.
Always include CPC so the user sees commercial value.

### `/seo technical <domain>`

```bash
~/.claude/skills/seo/scripts/on_page_audit.py site --target <domain> --max-crawl-pages 100
```

This kicks off a real crawl and waits for results (can take 2-5 minutes for
100 pages). When complete, group issues by severity (critical, high, medium,
low) and produce a prioritized fix list. Always include estimated impact.

For a quick single-page audit:

```bash
~/.claude/skills/seo/scripts/on_page_audit.py page --url <url>
```

### `/seo competitors <domain>`

```bash
~/.claude/skills/seo/scripts/domain_overview.py competitors --target <domain> --limit 20
```

For the top 5 competitors, also pull their ranked keywords and intersect with
the user's domain to identify SERP overlap and content gaps. Output:

- Top 10 competitors table (domain, organic keywords, traffic estimate)
- Shared keywords vs. unique keywords for each competitor
- 3 specific competitors to study most closely (and why)

### `/seo content <domain>`

```bash
~/.claude/skills/seo/scripts/domain_overview.py ranked --target <domain> --limit 200
```

Cluster the ranked keywords into topics. Identify:
- Strong topics (5+ keywords ranking top 10)
- Weak topics (lots of keywords, none top 10 — opportunity)
- Missing topics (competitors have them, you don't — use content_gap)

### `/seo backlinks <domain>`

```bash
~/.claude/skills/seo/scripts/backlinks.py summary --target <domain>
~/.claude/skills/seo/scripts/backlinks.py refdomains --target <domain> --limit 50
~/.claude/skills/seo/scripts/backlinks.py anchors --target <domain> --limit 30
```

Report on: total backlinks, referring domains, dofollow ratio, top anchors
(flag over-optimization), top referring domains by rank, and any toxicity
indicators (spam score, suspicious patterns).

### `/seo rankings <domain> <keyword1> <keyword2> ...`

```bash
~/.claude/skills/seo/scripts/serp_check.py rank --domain <domain> --keywords kw1 kw2 ...
```

Returns position (or "not in top 100") for each keyword. Group by:
- 🟢 Position 1-3 (winning)
- 🟡 Position 4-10 (page 1 — fight for top 3)
- 🟠 Position 11-30 (close — push to page 1)
- 🔴 Position 31-100 / not ranking (long-haul or pivot)

### `/seo content-gap <you> <competitor>`

```bash
~/.claude/skills/seo/scripts/domain_overview.py content_gap --you <you> --competitors <comp>
```

Returns keywords the competitor ranks for and you don't. Sort by search
volume × ranking position (closer to page 1 = easier wins for them).

### `/seo compare <domain1> <domain2>`

Run `overview`, `ranked` (limit 50), and `summary` for **both** domains in
parallel, plus an `intersect` call to find shared keywords. Output a
side-by-side comparison table covering keywords, traffic, backlinks,
referring domains, top shared keywords, and a verdict.

### `/seo report-pdf <domain>`

```bash
~/.claude/skills/seo/scripts/generate_pdf_report.py \
    --input ~/.claude/skills/seo/output/<domain>-audit.json \
    --output ~/.claude/skills/seo/output/<domain>-report.pdf
```

Requires that `/seo audit` ran first and saved the JSON. Open the PDF when done.

---

## Output Conventions

- Save all intermediate JSON to `~/.claude/skills/seo/output/<domain>-<command>.json`
- Always print a tight executive summary first (≤8 lines), then the detail
- Use score badges: 🟢 80+, 🔵 60-79, 🟡 40-59, 🔴 <40
- End every audit with a "Top 3 Actions This Week" section

---

## DataForSEO API Notes

- All scripts use the **live** endpoint variants (synchronous, no polling)
  except `on_page/site` which requires a true crawl
- Default location is `United States`, language `en` — pass `--location` /
  `--language` to override (e.g. `--location "United Kingdom" --language en`)
- A typical full audit costs ~$0.10-0.30 in DataForSEO credits
- The shared client is at [scripts/dataforseo_client.py](scripts/dataforseo_client.py)

---

## When NOT To Use This Skill

- AI search visibility (ChatGPT, Perplexity, Gemini citations) → use `/geo` instead
- Google Business Profile / local pack tracking → DataForSEO has it but a
  dedicated local-SEO tool would be a better fit
- Pure content writing (no data needed) → use a content skill directly
