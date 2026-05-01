---
name: seo-audit
description: Full SEO audit powered by the DataForSEO API. Orchestrates 5 specialist subagents (keywords, technical, competitors, content, backlinks) hitting DataForSEO Keywords Data, SERP, On-Page, Backlinks, and Labs endpoints in parallel, then produces a composite SEO Score (0-100) with prioritized action plan and audit JSON ready for PDF export.
allowed-tools:
  - Bash
  - Write
  - Read
  - Agent
---

# SEO Audit Orchestrator

> **Powered by:** [DataForSEO API](https://dataforseo.com) — every metric below comes from live calls to DataForSEO Keywords Data, SERP, On-Page, Backlinks, and Labs endpoints.
> **Cost:** ~$0.10-0.30 per full audit · **Setup:** add credentials to `~/.claude/skills/seo/.env`

## Workflow

### Phase 1: Spawn 5 subagents in parallel

Use the Agent tool to launch all five **in a single message**:

| Subagent type | Task |
|---------------|------|
| `seo-keywords` | "Run keyword analysis for `<domain>`. Return JSON with keyword_score (0-100), top_opportunities (top 20 by volume/difficulty ratio), and intent_breakdown." |
| `seo-technical` | "Run technical audit for `<domain>` (max 100 pages). Return JSON with technical_score (0-100), critical_issues, high_issues, and crawl_summary." |
| `seo-competitors` | "Find top 10 competitors for `<domain>`. Return JSON with competitive_score (0-100), competitors list, and serp_overlap." |
| `seo-content` | "Analyze content topical authority for `<domain>`. Return JSON with content_score (0-100), strong_topics, weak_topics, missing_topics." |
| `seo-backlinks` | "Audit backlink profile for `<domain>`. Return JSON with authority_score (0-100), backlink_summary, top_referrers, anchor_distribution, toxicity_flags." |

### Phase 2: Compute composite

```
overall = round(
    0.25 * keyword_score +
    0.25 * technical_score +
    0.20 * competitive_score +
    0.15 * content_score +
    0.15 * authority_score
)
```

### Phase 3: Build audit JSON

Match this shape (see `~/.claude/skills/seo/schema/audit_input.example.json`):

```json
{
  "target": "<domain>",
  "generated_at": "<ISO date>",
  "scores": {
    "overall": 72,
    "keywords": 78, "technical": 65, "competitors": 70,
    "content": 75, "authority": 68
  },
  "executive_summary": "<3-5 sentences — what this site does well, what it doesn't, and the single most impactful next move>",
  "key_metrics": {
    "estimated_traffic": "...",
    "ranking_keywords": "...",
    "backlinks": "...",
    "referring_domains": "..."
  },
  "issues": [
    {"priority": "critical", "title": "...", "recommendation": "..."},
    ...
  ],
  "top_keywords": [
    {"keyword": "...", "search_volume": 1000, "cpc": 2.5, "difficulty": 45, "position": 12},
    ...
  ],
  "competitors": [
    {"domain": "...", "keywords": 1234, "traffic": 5678, "rank": 542},
    ...
  ]
}
```

Save to: `~/.claude/skills/seo/output/<domain>-audit.json`

### Phase 4: Present summary + offer PDF

Show the composite score with a colored badge, the executive summary, the
top 5 issues, and the top 5 keyword opportunities. End with:

> Run `/seo report-pdf <domain>` to generate the client PDF.

## Cost note

A full audit typically uses ~$0.10-0.30 of DataForSEO credit. Warn the user
if running on the free trial credit ($1).
