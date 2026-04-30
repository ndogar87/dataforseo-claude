---
name: seo-content
description: Content topical authority and gap analysis. Clusters a domain's ranked keywords into topics, identifies strong vs weak vs missing topic clusters, and returns a Content Score (0-100) plus the highest-leverage content opportunities.
allowed-tools:
  - Bash
  - Write
---

# SEO Content Authority Skill

## Run

Pull what the target ranks for, plus the top competitor's ranked keywords:

```bash
~/.claude/skills/seo/scripts/domain_overview.py ranked --target <domain> --limit 200
~/.claude/skills/seo/scripts/domain_overview.py competitors --target <domain> --limit 5
~/.claude/skills/seo/scripts/domain_overview.py content_gap --you <domain> --competitors <c1> <c2> <c3>
```

## Topic clustering

Group keywords into topical clusters using common stems / shared head terms.
Don't be too granular — aim for 8-15 clusters max for a typical site.

Example clusters for an SEO tool site:
- "keyword research" (head: keyword)
- "rank tracking" (head: rank, ranking)
- "backlinks" (head: backlink, link building)
- "site audit" (head: audit, technical)
- ...

## For each cluster, classify it

| Status | Definition |
|--------|------------|
| **Strong** | 5+ keywords ranking top 10, total est. traffic > 100/mo |
| **Building** | Some keywords top 30, none top 10 yet |
| **Weak** | Keywords ranking but all below position 30 |
| **Missing** | Competitors rank, you don't (from content_gap) |

## Content Score (0-100)

```
content_score = round(
    50 * (strong_clusters / total_clusters) +
    25 * (1 - missing_clusters / total_clusters) +
    25 * (avg_position_top_quartile_score)
)
```

## Highest-leverage content moves

Surface the **top 5 specific articles to write next**. Pick from the
"Missing" and "Building" clusters, prioritizing keywords with:
- Search volume > 200/mo
- Difficulty < competitor's domain rank
- Commercial or transactional intent

For each, suggest: working title, target keyword, related keywords to include,
estimated word count.

## Return JSON shape

```json
{
  "content_score": 64,
  "strong_topics": [{"cluster": "...", "keywords": 12, "avg_position": 5.2}],
  "weak_topics": [{"cluster": "...", "keywords": 18, "avg_position": 42.1}],
  "missing_topics": [{"cluster": "...", "competitor": "...", "keyword_count": 24}],
  "content_recommendations": [
    {"title": "...", "target_keyword": "...", "volume": 880, "difficulty": 22, "intent": "commercial"}
  ]
}
```
