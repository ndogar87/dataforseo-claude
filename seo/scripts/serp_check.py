#!/usr/bin/env python3
"""SERP rank checks via DataForSEO SERP API (live, organic).

Usage:
  serp_check.py rank --domain example.com --keywords kw1 kw2 ...
  serp_check.py serp --keyword "best running shoes" [--depth 100]
  serp_check.py featured --keyword "what is geo"   # featured snippet / AIO check

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
        call,
        first_result,
        normalize_domain,
        write_json,
    )


def _serp_payload(
    keyword: str,
    location: str,
    language: str,
    device: str,
    depth: int,
) -> dict[str, Any]:
    return {
        "keyword": keyword,
        "location_name": location,
        "language_code": language,
        "device": device,
        "os": "windows" if device == "desktop" else "ios",
        "depth": depth,
    }


def cmd_serp(
    keyword: str,
    location: str = DEFAULT_LOCATION,
    language: str = DEFAULT_LANGUAGE,
    device: str = "desktop",
    depth: int = 100,
) -> dict[str, Any]:
    """Full organic SERP for a keyword."""
    data = call(
        "serp/google/organic/live/advanced",
        _serp_payload(keyword, location, language, device, depth),
    )
    result = first_result(data)
    return {
        "keyword": keyword,
        "location": location,
        "items": result.get("items") or [],
        "se_results_count": result.get("se_results_count"),
        "spell": result.get("spell"),
    }


def cmd_rank(
    domain: str,
    keywords: list[str],
    location: str = DEFAULT_LOCATION,
    language: str = DEFAULT_LANGUAGE,
    device: str = "desktop",
    depth: int = 100,
) -> dict[str, Any]:
    """For each keyword, find the target domain's organic position (1..100)."""
    domain_norm = normalize_domain(domain)
    rankings: list[dict[str, Any]] = []
    for kw in keywords:
        data = call(
            "serp/google/organic/live/advanced",
            _serp_payload(kw, location, language, device, depth),
        )
        result = first_result(data)
        items = result.get("items") or []
        position = None
        url_found = None
        title_found = None
        for item in items:
            if item.get("type") != "organic":
                continue
            item_domain = normalize_domain(item.get("domain") or "")
            if domain_norm in item_domain or item_domain.endswith(domain_norm):
                position = item.get("rank_absolute") or item.get("rank_group")
                url_found = item.get("url")
                title_found = item.get("title")
                break
        rankings.append({
            "keyword": kw,
            "position": position,
            "url": url_found,
            "title": title_found,
        })
    return {"domain": domain_norm, "rankings": rankings}


def cmd_featured(
    keyword: str,
    location: str = DEFAULT_LOCATION,
    language: str = DEFAULT_LANGUAGE,
    device: str = "desktop",
    depth: int = 100,
) -> dict[str, Any]:
    """Detect featured snippet, AI overview, PAA, and other SERP features."""
    data = call(
        "serp/google/organic/live/advanced",
        _serp_payload(keyword, location, language, device, depth),
    )
    result = first_result(data)
    items = result.get("items") or []
    features: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        t = item.get("type")
        if t and t != "organic":
            features.setdefault(t, []).append({
                "rank_absolute": item.get("rank_absolute"),
                "title": item.get("title"),
                "domain": item.get("domain"),
                "url": item.get("url"),
            })
    return {
        "keyword": keyword,
        "item_types_present": result.get("item_types"),
        "features": features,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="DataForSEO SERP checks.")
    parser.add_argument("--location", default=DEFAULT_LOCATION)
    parser.add_argument("--language", default=DEFAULT_LANGUAGE)
    parser.add_argument("--device", default="desktop", choices=["desktop", "mobile"])
    parser.add_argument("--depth", type=int, default=100)
    parser.add_argument("--out", "-o", default="-")

    sub = parser.add_subparsers(dest="cmd", required=True)

    p_serp = sub.add_parser("serp", help="Full organic SERP for a keyword.")
    p_serp.add_argument("--keyword", required=True)
    p_serp.set_defaults(
        func=lambda a: cmd_serp(a.keyword, a.location, a.language, a.device, a.depth)
    )

    p_rank = sub.add_parser("rank", help="Rank check for a domain across keywords.")
    p_rank.add_argument("--domain", required=True)
    p_rank.add_argument("--keywords", nargs="+", required=True)
    p_rank.set_defaults(
        func=lambda a: cmd_rank(
            a.domain, a.keywords, a.location, a.language, a.device, a.depth
        )
    )

    p_feat = sub.add_parser("featured", help="SERP feature breakdown for a keyword.")
    p_feat.add_argument("--keyword", required=True)
    p_feat.set_defaults(
        func=lambda a: cmd_featured(a.keyword, a.location, a.language, a.device, a.depth)
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
