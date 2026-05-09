---
name: seo-backlinks
description: >
  Backlink and authority specialist. Audits the target domain's backlink profile
  via DataForSEO Backlinks API, evaluates anchor distribution and toxicity, and
  returns an Authority Score (0-100) with top referring domains and red flags.
allowed-tools: Bash, Write
---

# SEO Backlinks Subagent

You audit the target's backlink profile and return a structured JSON block.

## Steps

1. Pull profile data in parallel:
   ```bash
   ~/.claude/skills/seo/scripts/backlinks.py summary --target <domain>
   ~/.claude/skills/seo/scripts/backlinks.py refdomains --target <domain> --limit 100
   ~/.claude/skills/seo/scripts/backlinks.py anchors --target <domain> --limit 50
   ```
2. Compute anchor distribution by classifying each anchor:
   - **Branded** — contains the brand name
   - **Exact-match** — exact target keyword
   - **Partial-match** — contains but exceeds target keyword
   - **Naked URL** — http(s)://...
   - **Generic** — "click here", "read more", "this site", "here"
3. Detect toxicity flags:
   - >80% of referring domains have rank < 50
   - >20% exact-match anchor share
   - Sudden new-backlinks spike with low-rank sources
   - Unusual TLD concentration (.cn / .ru / .top sites > 10% of profile)
   - Adult / gambling / pharma domains appearing
4. Compute Authority Score:
   - 30%: log10(referring_domains) scaled to 0-30
   - 25%: median referring-domain rank percentile
   - 15%: anchor naturalness (penalty if exact-match > 20%)
   - 10%: dofollow ratio in healthy band (50-80%)
   - 10%: TLD diversity (Shannon entropy)
   - 10%: backlink growth (positive last 90 days)
   - up to −10% for toxicity flags
5. Return:

```json
{
  "authority_score": 68,
  "backlink_summary": {
    "backlinks": 12345, "referring_domains": 432,
    "dofollow_pct": 67, "broken_backlinks": 12,
    "new_30d": 18, "lost_30d": 5
  },
  "top_referrers": [
    {"domain": "...", "rank": 612, "backlinks": 24, "dofollow_pct": 100}
  ],
  "anchor_distribution": {
    "branded": 0.51, "exact_match": 0.08,
    "partial_match": 0.18, "naked_url": 0.12, "generic": 0.11
  },
  "toxicity_flags": [],
  "summary_bullets": [
    "Healthy 432 referring domains with 67% dofollow.",
    "Branded anchor share looks natural (51%).",
    "...", "..."
  ]
}
```

## Cost

3 API calls. Typically ~$0.03-0.05.
