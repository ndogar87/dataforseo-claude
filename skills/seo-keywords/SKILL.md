---
name: seo-keywords
description: Keyword research and opportunity scoring via the DataForSEO Keywords Data and Labs APIs. Returns search volume, CPC, competition, intent classification, related keywords, and long-tail suggestions with a Keyword Score (0-100).
allowed-tools:
  - Bash
  - Write
---

# SEO Keyword Research Skill

> **Powered by:** [DataForSEO API](https://dataforseo.com) — Keywords Data `google_ads/search_volume` + Labs `related_keywords` + Labs `keyword_suggestions` + Labs `bulk_keyword_difficulty`.
> **Cost:** ~$0.05-0.10 per keyword run.

## Inputs

- A seed keyword OR a domain (call it `<seed>`)
- Optional: `--location` (default United States), `--language` (default en)

## Run

For a **seed keyword**:

```bash
~/.claude/skills/seo/scripts/keyword_research.py related "<seed>" --limit 200
~/.claude/skills/seo/scripts/keyword_research.py suggestions "<seed>" --limit 100
```

For a **domain** (find the keywords it already ranks for):

```bash
~/.claude/skills/seo/scripts/domain_overview.py ranked --target <domain> --limit 200
```

## Analysis

### Group by search intent

Classify each keyword into one of:
- **Informational** — "how to", "what is", "guide", "tutorial"
- **Commercial** — "best", "review", "comparison", "vs"
- **Transactional** — "buy", "price", "deal", "near me", brand+product
- **Navigational** — brand names, specific URLs

### Opportunity score per keyword

```
opportunity = search_volume / (keyword_difficulty + 10)
```

Higher = better. Surface the **top 20** sorted by opportunity.

### Keyword Score (0-100)

| Signal | Weight |
|--------|--------|
| Avg. search volume of top 50 keywords (log-scaled) | 30% |
| Share of low-difficulty keywords (KD < 30) in top 50 | 25% |
| Intent diversity (4 buckets present) | 15% |
| CPC value (high CPC = commercial intent) | 15% |
| Long-tail breadth (count of suggestions) | 15% |

Output: a Keyword Score with a one-sentence justification.

## Return JSON shape (when called from `/seo audit`)

```json
{
  "keyword_score": 78,
  "top_opportunities": [
    {"keyword": "...", "search_volume": 1000, "cpc": 2.5, "difficulty": 25, "intent": "commercial", "opportunity": 28.5},
    ...
  ],
  "intent_breakdown": {"informational": 45, "commercial": 32, "transactional": 18, "navigational": 5}
}
```
