---
name: seo-competitors
description: Identify true SEO competitors and quantify the gap. Returns the top 10 competing domains by SERP overlap, with shared and unique keywords, traffic estimates, and a Competitive Score (0-100) showing how dominant the target is in its category.
allowed-tools:
  - Bash
  - Write
---

# SEO Competitor Analysis Skill

## Run

```bash
~/.claude/skills/seo/scripts/domain_overview.py competitors --target <domain> --limit 20
```

For each of the top 5 competitors, also pull intersection (shared keywords):

```bash
~/.claude/skills/seo/scripts/domain_overview.py intersect --you <domain> --competitor <competitor>
```

## What to surface

### Top 10 competitors table

| Rank | Domain | Common keywords | Their unique keywords | Est. traffic | Domain rank |
|------|--------|----------------|-----------------------|--------------|-------------|

The DataForSEO competitors endpoint already ranks them by SERP overlap with
your target — keep that order.

### SERP overlap analysis

For the top 3 competitors:
- How many keywords does the target share with them? (intersect call)
- What's the average position gap? (you at #15, them at #4 = -11 gap)
- Any keywords where the target outranks the competitor? (rare wins to defend)

### Strategic groupings

- **Direct competitors** — share 30%+ of keywords
- **Adjacent competitors** — share 10-30% (worth monitoring, not chasing)
- **Aspirational** — much higher domain rank, shared keywords < 10% (long-term)

## Competitive Score (0-100)

How dominant is the target in its competitive set?

```
competitive_score = 100 * (target_traffic / max(sum_of_top_10_traffic, 1))
```

Capped at 100. Above 30 = strong, 10-30 = mid-tier, <10 = challenger.

## Return JSON shape

```json
{
  "competitive_score": 24,
  "competitors": [
    {"domain": "...", "common_keywords": 1234, "unique_keywords": 5678, "traffic": 99999, "rank": 421},
    ...
  ],
  "serp_overlap": {
    "<competitor>": {"shared": 234, "avg_gap": -8.4, "wins": 12}
  },
  "strategic_groups": {
    "direct": ["a.com", "b.com"],
    "adjacent": ["c.com"],
    "aspirational": ["d.com"]
  }
}
```
