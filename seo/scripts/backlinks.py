#!/usr/bin/env python3
"""Backlink analysis via DataForSEO Backlinks API.

Usage:
  backlinks.py summary --target example.com
  backlinks.py top   --target example.com [--limit 100]
  backlinks.py refdomains --target example.com [--limit 100]
  backlinks.py anchors --target example.com [--limit 100]
  backlinks.py compare --targets domain1.com domain2.com domain3.com

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
        DataForSEOError,
        all_items,
        call,
        first_result,
        normalize_domain,
        write_json,
    )
except ImportError:
    from dataforseo_client import (  # type: ignore[no-redef]
        DataForSEOError,
        all_items,
        call,
        first_result,
        normalize_domain,
        write_json,
    )


def cmd_summary(target: str) -> dict[str, Any]:
    """Backlink summary metrics for a target domain."""
    payload = {"target": normalize_domain(target), "internal_list_limit": 10}
    data = call("backlinks/summary/live", payload)
    return first_result(data)


def cmd_top(target: str, limit: int = 100) -> dict[str, Any]:
    """Top dofollow backlinks ordered by rank."""
    payload = {
        "target": normalize_domain(target),
        "limit": limit,
        "mode": "as_is",
        "filters": [["dofollow", "=", True]],
        "order_by": ["rank,desc"],
    }
    data = call("backlinks/backlinks/live", payload)
    items = all_items(data)
    return {"target": target, "count": len(items), "items": items}


def cmd_refdomains(target: str, limit: int = 100) -> dict[str, Any]:
    """Referring domains ordered by rank."""
    payload = {
        "target": normalize_domain(target),
        "limit": limit,
        "order_by": ["rank,desc"],
    }
    data = call("backlinks/referring_domains/live", payload)
    items = all_items(data)
    return {"target": target, "count": len(items), "items": items}


def cmd_anchors(target: str, limit: int = 100) -> dict[str, Any]:
    """Anchor text distribution for a target domain."""
    payload = {
        "target": normalize_domain(target),
        "limit": limit,
        "order_by": ["backlinks,desc"],
    }
    data = call("backlinks/anchors/live", payload)
    items = all_items(data)
    return {"target": target, "count": len(items), "items": items}


def cmd_compare(targets: list[str]) -> dict[str, Any]:
    """Side-by-side backlink summary for multiple domains."""
    summaries: list[dict[str, Any]] = []
    for target in targets:
        payload = {"target": normalize_domain(target), "internal_list_limit": 5}
        data = call("backlinks/summary/live", payload)
        summaries.append({"target": target, "summary": first_result(data)})
    return {"comparison": summaries}


def cmd_intersect(you: str, competitor: str, limit: int = 100) -> dict[str, Any]:
    """Domains that link to competitors but not to you - backlink gap."""
    payload = {
        "targets": {
            "1": normalize_domain(you),
            "2": normalize_domain(competitor),
        },
        "exclude_targets": [normalize_domain(you)],
        "limit": limit,
        "order_by": ["rank,desc"],
    }
    data = call("backlinks/domain_intersection/live", payload)
    items = all_items(data)
    return {
        "you": you,
        "competitor": competitor,
        "gap_count": len(items),
        "items": items,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="DataForSEO Backlinks helper.")
    parser.add_argument("--out", "-o", default="-")

    sub = parser.add_subparsers(dest="cmd", required=True)

    p1 = sub.add_parser("summary")
    p1.add_argument("--target", required=True)
    p1.set_defaults(func=lambda a: cmd_summary(a.target))

    p2 = sub.add_parser("top")
    p2.add_argument("--target", required=True)
    p2.add_argument("--limit", type=int, default=100)
    p2.set_defaults(func=lambda a: cmd_top(a.target, a.limit))

    p3 = sub.add_parser("refdomains")
    p3.add_argument("--target", required=True)
    p3.add_argument("--limit", type=int, default=100)
    p3.set_defaults(func=lambda a: cmd_refdomains(a.target, a.limit))

    p4 = sub.add_parser("anchors")
    p4.add_argument("--target", required=True)
    p4.add_argument("--limit", type=int, default=100)
    p4.set_defaults(func=lambda a: cmd_anchors(a.target, a.limit))

    p5 = sub.add_parser("compare")
    p5.add_argument("--targets", nargs="+", required=True)
    p5.set_defaults(func=lambda a: cmd_compare(a.targets))

    p6 = sub.add_parser("intersect", help="Backlink gap between you and a competitor.")
    p6.add_argument("--you", required=True)
    p6.add_argument("--competitor", required=True)
    p6.add_argument("--limit", type=int, default=100)
    p6.set_defaults(func=lambda a: cmd_intersect(a.you, a.competitor, a.limit))

    args = parser.parse_args()
    try:
        result = args.func(args)
    except DataForSEOError as exc:
        sys.stderr.write(f"ERROR: {exc}\n")
        sys.exit(1)
    write_json(result, args.out)


if __name__ == "__main__":
    sys.exit(main() or 0)
