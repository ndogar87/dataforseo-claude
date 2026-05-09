#!/usr/bin/env python3
"""Keyword research via DataForSEO Keywords Data + Labs APIs.

Usage:
  keyword_research.py seed "<seed keyword>" [--location "United States"] [--language en]
  keyword_research.py related "<seed keyword>" [--depth 1] [--limit 200]
  keyword_research.py suggestions "<seed keyword>" [--limit 200]
  keyword_research.py volume kw1 kw2 kw3 ...

Output: JSON to stdout. Claude reads this and produces analysis.

This module is also importable as a library: each `cmd_*` function returns
a dict and is safe to call from a long-running worker process. The CLI
shim at the bottom is the only caller that prints / exits.
"""

from __future__ import annotations

import argparse
import sys
from typing import Any

try:  # Library import (e.g. `from seo.scripts import keyword_research`)
    from .dataforseo_client import (
        DEFAULT_LANGUAGE,
        DEFAULT_LOCATION,
        DataForSEOError,
        all_items,
        call,
        write_json,
    )
except ImportError:  # CLI invocation: `python keyword_research.py ...`
    from dataforseo_client import (  # type: ignore[no-redef]
        DEFAULT_LANGUAGE,
        DEFAULT_LOCATION,
        DataForSEOError,
        all_items,
        call,
        write_json,
    )


def cmd_seed(
    keyword: str,
    location: str = DEFAULT_LOCATION,
    language: str = DEFAULT_LANGUAGE,
) -> dict[str, Any]:
    """Pull search volume + CPC + competition for a single seed keyword."""
    payload = {
        "keywords": [keyword],
        "location_name": location,
        "language_code": language,
    }
    data = call("keywords_data/google_ads/search_volume/live", payload)
    items = all_items(data)
    return {"keyword": keyword, "metrics": items}


def cmd_related(
    keyword: str,
    location: str = DEFAULT_LOCATION,
    language: str = DEFAULT_LANGUAGE,
    depth: int = 1,
    limit: int = 200,
) -> dict[str, Any]:
    """Related keywords with full SEO metrics."""
    payload = {
        "keyword": keyword,
        "location_name": location,
        "language_code": language,
        "depth": depth,
        "limit": limit,
        "include_seed_keyword": True,
    }
    data = call("dataforseo_labs/google/related_keywords/live", payload)
    return {"seed": keyword, "items": all_items(data)}


def cmd_suggestions(
    keyword: str,
    location: str = DEFAULT_LOCATION,
    language: str = DEFAULT_LANGUAGE,
    limit: int = 200,
) -> dict[str, Any]:
    """Long-tail suggestions ranked by search volume."""
    payload = {
        "keyword": keyword,
        "location_name": location,
        "language_code": language,
        "limit": limit,
        "include_serp_info": False,
        "order_by": ["keyword_info.search_volume,desc"],
    }
    data = call("dataforseo_labs/google/keyword_suggestions/live", payload)
    return {"seed": keyword, "items": all_items(data)}


def cmd_volume(
    keywords: list[str],
    location: str = DEFAULT_LOCATION,
    language: str = DEFAULT_LANGUAGE,
) -> dict[str, Any]:
    """Bulk volume + CPC for an arbitrary list of keywords."""
    payload = {
        "keywords": keywords,
        "location_name": location,
        "language_code": language,
    }
    data = call("keywords_data/google_ads/search_volume/live", payload)
    return {"items": all_items(data)}


def cmd_difficulty(
    keywords: list[str],
    location: str = DEFAULT_LOCATION,
    language: str = DEFAULT_LANGUAGE,
) -> dict[str, Any]:
    """Bulk keyword difficulty scores."""
    payload = {
        "keywords": keywords,
        "location_name": location,
        "language_code": language,
    }
    data = call("dataforseo_labs/google/bulk_keyword_difficulty/live", payload)
    return {"items": all_items(data)}


def main() -> None:
    parser = argparse.ArgumentParser(description="DataForSEO keyword research.")
    parser.add_argument("--location", default=DEFAULT_LOCATION)
    parser.add_argument("--language", default=DEFAULT_LANGUAGE)
    parser.add_argument("--out", "-o", default="-", help="Output file (default stdout).")

    sub = parser.add_subparsers(dest="cmd", required=True)

    p_seed = sub.add_parser("seed", help="Volume/CPC for a single keyword.")
    p_seed.add_argument("keyword")
    p_seed.set_defaults(func=lambda a: cmd_seed(a.keyword, a.location, a.language))

    p_related = sub.add_parser("related", help="Related keywords with metrics.")
    p_related.add_argument("keyword")
    p_related.add_argument("--depth", type=int, default=1, choices=[0, 1, 2, 3, 4])
    p_related.add_argument("--limit", type=int, default=200)
    p_related.set_defaults(
        func=lambda a: cmd_related(a.keyword, a.location, a.language, a.depth, a.limit)
    )

    p_sugg = sub.add_parser("suggestions", help="Long-tail suggestions.")
    p_sugg.add_argument("keyword")
    p_sugg.add_argument("--limit", type=int, default=200)
    p_sugg.set_defaults(
        func=lambda a: cmd_suggestions(a.keyword, a.location, a.language, a.limit)
    )

    p_vol = sub.add_parser("volume", help="Bulk search volume + CPC.")
    p_vol.add_argument("keywords", nargs="+")
    p_vol.set_defaults(func=lambda a: cmd_volume(a.keywords, a.location, a.language))

    p_diff = sub.add_parser("difficulty", help="Bulk keyword difficulty.")
    p_diff.add_argument("keywords", nargs="+")
    p_diff.set_defaults(func=lambda a: cmd_difficulty(a.keywords, a.location, a.language))

    args = parser.parse_args()
    try:
        result = args.func(args)
    except DataForSEOError as exc:
        sys.stderr.write(f"ERROR: {exc}\n")
        sys.exit(1)
    write_json(result, args.out)


if __name__ == "__main__":
    sys.exit(main() or 0)
