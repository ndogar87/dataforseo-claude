---
name: seo-quick
description: 60-second SEO snapshot powered by the DataForSEO API. Three parallel calls (DataForSEO Labs domain overview, Backlinks summary, ranked keywords) for core metrics on any domain — total keywords, traffic estimate, backlinks, top rankings — without waiting for a full audit.
allowed-tools:
  - Bash
  - Write
---

# SEO Quick Snapshot

> **Powered by:** [DataForSEO API](https://dataforseo.com) — Labs `domain_rank_overview` + Backlinks `summary` + Labs `ranked_keywords`.
> **Cost:** ~$0.01-0.03 per run.

Three parallel API calls, then a tight summary.

## Run

```bash
~/.claude/skills/seo/scripts/domain_overview.py overview --target <domain>
~/.claude/skills/seo/scripts/backlinks.py summary --target <domain>
~/.claude/skills/seo/scripts/domain_overview.py ranked --target <domain> --limit 25
```

## Output Format

```
🟢/🟡/🔴 SEO Snapshot: <domain>

• Estimated organic traffic: <N>/mo
• Total ranking keywords: <N>  (top 3: <X>, top 10: <Y>)
• Backlinks: <N> from <N> referring domains  (dofollow: <X>%)
• Domain rank: <N>/1000

Top 5 keywords by traffic value:
1. <keyword> — pos <N>, vol <V>, $<CPC>
...

Headline finding: <one sentence — biggest opportunity OR biggest weakness>
```

No subagents. No PDF. ≤30 seconds end to end.
