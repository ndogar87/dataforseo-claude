---
name: seo-rankings
description: On-demand rank checking. Looks up Google organic position for a domain across an arbitrary list of keywords. Reports each as winning / page-1 / close / not-ranking with one prioritized next action per keyword.
allowed-tools:
  - Bash
  - Write
---

# SEO Rank Checker Skill

## Run

```bash
~/.claude/skills/seo/scripts/serp_check.py rank --domain <domain> --keywords kw1 kw2 kw3 ...
```

Optional: `--location "United States"`, `--language en`, `--device desktop|mobile`, `--depth 100`.

## Output groups

| Tier | Position | Action |
|------|----------|--------|
| 🟢 **Winning** | 1–3 | Defend — monitor weekly |
| 🟡 **Page 1** | 4–10 | Push to top 3 — internal links + on-page polish |
| 🟠 **Close** | 11–30 | Strongest leverage — re-optimize, build links |
| 🔴 **Long-haul** | 31–100 | Pivot or invest heavily |
| ⚫ **Not ranking** | none | Decide: pursue or drop |

For each keyword, also pull search volume in the same run so the user knows
which positions are worth fighting for:

```bash
~/.claude/skills/seo/scripts/keyword_research.py volume kw1 kw2 kw3 ...
```

## Output table

```
Keyword              | Pos | Volume | URL                          | Action
---------------------|-----|--------|------------------------------|--------
seo audit tool       | 8   | 1,200  | /tools/seo-audit             | Push to top 3
keyword research     | 24  | 8,800  | /blog/keyword-research-guide | Re-optimize + build links
ai seo               | —   | 3,400  | (not ranking)                | Decide: write new piece?
```

End with the **single highest-leverage action** across all keywords.
