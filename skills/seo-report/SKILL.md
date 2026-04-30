---
name: seo-report
description: Generate a markdown SEO report deliverable from a saved audit. Produces a client-ready markdown document with executive summary, scores, key findings, prioritized actions, and supporting data tables.
allowed-tools:
  - Read
  - Write
---

# SEO Markdown Report Skill

Reads `~/.claude/skills/seo/output/<domain>-audit.json` and produces a
markdown report at `~/.claude/skills/seo/output/<domain>-report.md`.

## Structure

```markdown
# SEO Audit Report — <domain>
*Generated <date>*

## Executive Summary
<3-5 sentences from audit.executive_summary>

## Composite Score: <overall>/100

| Dimension | Score |
|-----------|-------|
| Keywords | <N>/100 |
| Technical | <N>/100 |
| Competitors | <N>/100 |
| Content | <N>/100 |
| Authority | <N>/100 |

## Key Metrics
<key_metrics as a 2-column table>

## Top 3 Actions This Week
1. **<action>** — <why it matters> (impact: high)
2. **<action>** — ...
3. **<action>** — ...

## Prioritized Issue List
<issues table — Priority | Issue | Recommendation>

## Top Keyword Opportunities
<top_keywords table>

## Competitive Landscape
<competitors table>

## Methodology
This report was generated using the dataforseo-claude skill pack, which
combines Claude Code's analysis with live data from DataForSEO's APIs.
All metrics reflect Google's organic search results in <location> at the
time of audit.

---
*Powered by DataForSEO + Claude Code*
```

## Tone

- Direct and confident — clients are paying for clarity
- Numbers, not adjectives — say "12,400 monthly visits" not "significant traffic"
- Recommendations are specific actions, not categories
  - ✅ "Rewrite the title tag on /pricing to lead with 'Pricing — [Brand]'"
  - ❌ "Improve title tags"
