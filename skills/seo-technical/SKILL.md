---
name: seo-technical
description: Technical SEO site audit via DataForSEO On-Page API. Crawls the site, surfaces critical errors (broken links, redirect chains, missing meta, slow pages, schema gaps, indexability issues), and returns a Technical Score (0-100) with prioritized fixes.
allowed-tools:
  - Bash
  - Write
---

# Technical SEO Audit Skill

## Run

For a single page (instant):

```bash
~/.claude/skills/seo/scripts/on_page_audit.py page --url <url>
```

For a full site crawl (2-5 min for 100 pages):

```bash
~/.claude/skills/seo/scripts/on_page_audit.py site --target <domain> --max-crawl-pages 100
```

## Categories to evaluate

Pull from the `summary.checks` and per-page `checks` objects:

### Indexability & Crawl
- `is_4xx_code`, `is_5xx_code`, `is_redirect` chains > 2 hops
- `canonical` mismatches
- `robots_txt`, blocked resources
- `is_https`, mixed content

### On-page meta
- Missing/duplicate `<title>`, `<meta description>`
- Title length (should be 50-60 chars), description (140-160)
- `h1` missing or duplicate
- Heading hierarchy gaps

### Speed & Core Web Vitals
- `time_to_interactive`, `largest_contentful_paint`
- `cumulative_layout_shift`
- Resource errors

### Content quality
- `plain_text_word_count` < 300 = thin content
- `plain_text_rate` (text vs. HTML)
- `automated_readability_index`

### Structured data
- Schema present? Which types?
- Missing organization / article / breadcrumb / product schema for the site type

## Issue priority rubric

| Priority | Examples |
|----------|----------|
| **Critical** | 5xx errors, no-index on key pages, broken canonical, mixed content, robots.txt blocking |
| **High** | Missing titles/descriptions on indexable pages, broken internal links, redirect chains, slow LCP (>4s) |
| **Medium** | Duplicate titles/descriptions, missing alt text at scale, thin content (<300 words) on key pages |
| **Low** | Heading hierarchy gaps, suboptimal title length, missing schema |

## Technical Score (0-100)

Start at 100. Subtract:
- 15 per critical issue (max 60)
- 5 per high issue (max 30)
- 1 per medium issue (max 15)
- 0.2 per low issue (max 5)

Floor at 0.

## Return JSON shape

```json
{
  "technical_score": 72,
  "crawl_summary": {"pages_crawled": 100, "errors": 8, "warnings": 23},
  "critical_issues": [{"title": "...", "count": 3, "recommendation": "..."}],
  "high_issues": [...],
  "medium_issues": [...]
}
```
