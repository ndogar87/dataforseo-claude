"""Composite SEO score formula.

Ported from `seo/SKILL.md`:

    overall = 0.25*keywords + 0.25*technical + 0.20*competitors
            + 0.15*content + 0.15*authority

Each sub-score is expected on the 0-100 scale. The function tolerates
missing keys (treated as 0) so partial audits still return a number,
and clamps the result to [0, 100].
"""

from __future__ import annotations

from typing import Mapping

WEIGHTS: dict[str, float] = {
    "keywords": 0.25,
    "technical": 0.25,
    "competitors": 0.20,
    "content": 0.15,
    "authority": 0.15,
}


def composite_score(scores: Mapping[str, float]) -> float:
    """Return the weighted SEO composite score in [0, 100]."""
    total = 0.0
    for key, weight in WEIGHTS.items():
        value = scores.get(key, 0) or 0
        try:
            total += float(value) * weight
        except (TypeError, ValueError):
            # Bad input for this sub-score: skip rather than blow up the audit.
            continue
    return max(0.0, min(100.0, round(total, 2)))
