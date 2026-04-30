---
name: seo-watchlist
description: Track multiple domains and keywords across runs. Saves a local watchlist of domains + their target keywords, then re-runs SERP rank checks on demand and surfaces any position changes since the last check.
allowed-tools:
  - Bash
  - Read
  - Write
---

# SEO Watchlist Skill

A simple file-based watchlist at `~/.claude/skills/seo/output/watchlist.json`.

## Schema

```json
{
  "domains": {
    "example.com": {
      "label": "Main site",
      "keywords": ["seo audit tool", "keyword research", "..."],
      "history": [
        {"date": "2026-04-15", "rankings": [{"keyword": "...", "position": 8}, ...]},
        {"date": "2026-04-22", "rankings": [{"keyword": "...", "position": 6}, ...]}
      ]
    }
  }
}
```

## Subcommands

### `add <domain> <keywords...>`

Read the existing watchlist (if any), add or update the domain entry, write back.
Run an immediate rank check and store as the first history entry.

### `list`

Print the watchlist in a human-readable table:
- Domain | label | # keywords | last checked | last avg position

### `check <domain>` or `check all`

Re-run SERP rank check on the saved keywords:

```bash
~/.claude/skills/seo/scripts/serp_check.py rank --domain <domain> --keywords <kw...>
```

Append the result to history, then **diff against the previous check**:

```
Movement since <last_date>:
🟢 Up:    "seo audit tool"     8 → 5  (+3)
🔴 Down:  "ai content tool"   12 → 18 (-6)
⚪ Same:  "..." 3 → 3
```

### `remove <domain>` and `remove <domain> <keyword>`

Drop a domain or a single keyword from the watchlist.

## Output

Always end with a short take: any concerning drops (-5 or worse), any
opportunities (rankings just outside top 10), and one suggested action.
