"""Make the sibling ``seo/`` package importable from inside ``worker/``.

The worker process needs ``from seo.scripts.<module> import cmd_<name>`` to
work in two deployment shapes:

  * **Local dev** — ``uvicorn main:app`` is run from ``worker/``. The
    ``seo/`` package lives one directory up (``../seo/``), so the repo
    root must be on ``sys.path``.
  * **Docker / production** — the ``Dockerfile`` copies ``seo/`` into
    ``/app/seo`` next to ``main.py``. ``/app`` is the working directory,
    which is already on ``sys.path``, so this module is a no-op there.

We resolve the candidate path at import time and only insert it if (a)
it isn't already on ``sys.path`` and (b) it actually exists. This keeps
the side-effect cheap and idempotent — importing this module multiple
times is harmless.

Importing this module has no return value; the side-effect is the
``sys.path`` insertion. Call sites just do ``import path_setup  # noqa``.
"""

from __future__ import annotations

import sys
from pathlib import Path


def _ensure_repo_root_on_path() -> None:
    # path_setup.py lives in worker/ → its parent is the repo root.
    repo_root = Path(__file__).resolve().parent.parent
    if not (repo_root / "seo").is_dir():
        # Production layout: seo/ already lives next to main.py inside /app.
        # Nothing to do; the regular cwd-based import will resolve.
        return
    repo_root_str = str(repo_root)
    if repo_root_str not in sys.path:
        sys.path.insert(0, repo_root_str)


_ensure_repo_root_on_path()
