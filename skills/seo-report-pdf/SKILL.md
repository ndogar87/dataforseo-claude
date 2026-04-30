---
name: seo-report-pdf
description: Generate a professional, client-ready PDF SEO report from a saved audit. Produces a polished PDF with score gauges, prioritized action plan, keyword opportunity tables, and competitive landscape — ready to send to a client.
allowed-tools:
  - Bash
  - Read
  - Write
---

# SEO PDF Report Skill

## Prerequisite

`/seo audit <domain>` must have run first and saved
`~/.claude/skills/seo/output/<domain>-audit.json`. If that file doesn't
exist, tell the user to run the audit first.

## Run

```bash
~/.claude/skills/seo/scripts/generate_pdf_report.py \
    --input ~/.claude/skills/seo/output/<domain>-audit.json \
    --output ~/.claude/skills/seo/output/<domain>-report.pdf
```

When the PDF is generated, print the absolute path and (on macOS) offer to
open it:

```bash
open ~/.claude/skills/seo/output/<domain>-report.pdf
```

## What's in the PDF

The generator (`scripts/generate_pdf_report.py`) reads the audit JSON and
produces:

- Cover with composite Overall / Keywords / Technical / Authority score cards
- Executive Summary
- Key Metrics block
- Prioritized Action Plan table (color-coded by priority)
- Top Keyword Opportunities table (with volume, CPC, difficulty, position)
- Competitive Landscape table

All sections gracefully skip if their data is missing from the audit JSON,
so partial audits still render a valid PDF.

## Customization

To change colors/fonts/branding for a client deliverable, edit the constants
at the top of [scripts/generate_pdf_report.py](../../seo/scripts/generate_pdf_report.py):

```python
BRAND_PRIMARY = colors.HexColor("#1f4e79")
BRAND_ACCENT  = colors.HexColor("#2e8b57")
```
