#!/usr/bin/env python3
"""Domain-level competitive intelligence via DataForSEO Labs.

Usage:
  domain_overview.py overview      --target example.com
  domain_overview.py ranked        --target example.com [--limit 100]
  domain_overview.py competitors   --target example.com [--limit 50]
  domain_overview.py intersect     --you you.com --competitor them.com [--limit 100]
  domain_overview.py content_gap   --you you.com --competitors a.com b.com c.com

Output: JSON to stdout.

This module is also importable as a library: each `cmd_*` function returns
a dict and is safe to call from a long-running worker process.
"""

from __future__ import annotations

import argparse
import sys
from typing import Any

try:
    from .dataforseo_client import (
        DEFAULT_LANGUAGE,
        DEFAULT_LOCATION,
        DataForSEOError,
        all_items,
        call,
        first_result,
        normalize_domain,
        write_json,
    )
except ImportError:
    from dataforseo_client import (  # type: ignore[no-redef]
        DEFAULT_LANGUAGE,
        DEFAULT_LOCATION,
        DataForSEOError,
        all_items,
        call,
        first_result,
        normalize_domain,
        write_json,
    )


def _loc_lang(location: str, language: str) -> dict[str, str]:
    return {"location_name": location, "language_code": language}


def cmd_overview(
    target: str,
    location: str = DEFAULT_LOCATION,
    language: str = DEFAULT_LANGUAGE,
) -> dict[str, Any]:
    """Domain rank overview metrics."""
    payload = {"target": normalize_domain(target), **_loc_lang(location, language)}
    data = call("dataforseo_labs/google/domain_rank_overview/live", payload)
    return first_result(data)


def cmd_ranked(
    target: str,
    location: str = DEFAULT_LOCATION,
    language: str = DEFAULT_LANGUAGE,
    limit: int = 100,
) -> dict[str, Any]:
    """Keywords the target domain currently ranks for."""
    payload = {
        "target": normalize_domain(target),
        "limit": limit,
        "order_by": ["keyword_data.keyword_info.search_volume,desc"],
        **_loc_lang(location, language),
    }
    data = call("dataforseo_labs/google/ranked_keywords/live", payload)
    return {"target": target, "items": all_items(data)}


def cmd_competitors(
    target: str,
    location: str = DEFAULT_LOCATION,
    language: str = DEFAULT_LANGUAGE,
    limit: int = 50,
) -> dict[str, Any]:
    """Organic competitors for a target domain."""
    payload = {
        "target": normalize_domain(target),
        "limit": limit,
        **_loc_lang(location, language),
    }
    data = call("dataforseo_labs/google/competitors_domain/live", payload)
    return {"target": target, "items": all_items(data)}


def cmd_intersect(
    you: str,
    competitor: str,
    location: str = DEFAULT_LOCATION,
    language: str = DEFAULT_LANGUAGE,
    limit: int = 100,
) -> dict[str, Any]:
    """Keywords where BOTH domains rank (head-to-head intersection)."""
    payload = {
        "target1": normalize_domain(you),
        "target2": normalize_domain(competitor),
        "intersections": True,
        "limit": limit,
        **_loc_lang(location, language),
    }
    data = call("dataforseo_labs/google/domain_intersection/live", payload)
    return {
        "you": you,
        "competitor": competitor,
        "items": all_items(data),
    }


def cmd_content_gap(
    you: str,
    competitors: list[str],
    location: str = DEFAULT_LOCATION,
    language: str = DEFAULT_LANGUAGE,
    limit: int = 100,
) -> dict[str, Any]:
    """Keywords competitors rank for that you don't - content gap."""
    you_norm = normalize_domain(you)
    items_by_competitor: dict[str, list[dict[str, Any]]] = {}
    for comp in competitors:
        payload = {
            "target1": normalize_domain(comp),
            "target2": you_norm,
            "intersections": False,
            "limit": limit,
            "order_by": ["first_domain_serp_element.keyword_data.keyword_info.search_volume,desc"],
            **_loc_lang(location, language),
        }
        data = call("dataforseo_labs/google/domain_intersection/live", payload)
        items_by_competitor[comp] = all_items(data)
    return {"you": you, "gaps": items_by_competitor}


def main() -> None:
    parser = argparse.ArgumentParser(description="DataForSEO domain analytics.")
    parser.add_argument("--location", default=DEFAULT_LOCATION)
    parser.add_argument("--language", default=DEFAULT_LANGUAGE)
    parser.add_argument("--out", "-o", default="-")

    sub = parser.add_subparsers(dest="cmd", required=True)

    p1 = sub.add_parser("overview")
    p1.add_argument("--target", required=True)
    p1.set_defaults(func=lambda a: cmd_overview(a.target, a.location, a.language))

    p2 = sub.add_parser("ranked")
    p2.add_argument("--target", required=True)
    p2.add_argument("--limit", type=int, default=100)
    p2.set_defaults(func=lambda a: cmd_ranked(a.target, a.location, a.language, a.limit))

    p3 = sub.add_parser("competitors")
    p3.add_argument("--target", required=True)
    p3.add_argument("--limit", type=int, default=50)
    p3.set_defaults(func=lambda a: cmd_competitors(a.target, a.location, a.language, a.limit))

    p4 = sub.add_parser("intersect")
    p4.add_argument("--you", required=True)
    p4.add_argument("--competitor", required=True)
    p4.add_argument("--limit", type=int, default=100)
    p4.set_defaults(
        func=lambda a: cmd_intersect(a.you, a.competitor, a.location, a.language, a.limit)
    )

    p5 = sub.add_parser("content_gap")
    p5.add_argument("--you", required=True)
    p5.add_argument("--competitors", nargs="+", required=True)
    p5.add_argument("--limit", type=int, default=100)
    p5.set_defaults(
        func=lambda a: cmd_content_gap(a.you, a.competitors, a.location, a.language, a.limit)
    )

    args = parser.parse_args()
    try:
        result = args.func(args)
    except DataForSEOError as exc:
        sys.stderr.write(f"ERROR: {exc}\n")
        sys.exit(1)
    write_json(result, args.out)


if __name__ == "__main__":
    sys.exit(main() or 0)
