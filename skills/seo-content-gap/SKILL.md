---
name: seo-content-gap
description: Find keywords competitors rank for that you don't. Uses DataForSEO domain intersection to surface the highest-leverage content opportunities sorted by search volume and the competitor's ranking position.
allowed-tools:
  - Bash
  - Write
---

# Content Gap Skill

## Run

```bash
~/.claude/skills/seo/scripts/domain_overview.py content_gap --you <you> --competitors <c1> <c2> <c3>
```

You can pass 1–5 competitors. The script returns, per competitor, the
keywords where they rank in the top 100 and you don't.

## Sort and surface

For each competitor's gap list, sort by:

```
priority = search_volume * (101 - competitor_position)
```

Higher = the competitor is ranking high for a high-volume keyword you have
nothing for — hot opportunity.

## Output structure

For each competitor:

```
Gap vs <competitor>: <N> keywords where they rank, you don't

Top 10 to pursue:
1. "<keyword>" — they're #<pos>, vol <V>, KD <D>, $<CPC>
   → They rank a <page_type> at <url>
2. ...
```

## Cross-competitor consensus

After processing all competitors, find keywords that **multiple competitors**
rank for. These are the strongest signals — if every competitor has content
on a topic and you don't, that's a clear hole in your strategy.

```
Consensus gaps (3+ competitors rank, you don't):
- "<keyword>"   ← 4 competitors rank top 20
- "<keyword>"   ← 3 competitors rank top 10
```

End with a 5-article content roadmap with target keyword, working title,
priority score, and which competitor's article to study.
