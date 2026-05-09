# syntax=docker/dockerfile:1.7
# Multi-stage build for the dataforseo-claude FastAPI worker.
#
# IMPORTANT: build with the repo root as context, not worker/, because the
# worker imports the sibling ``seo/`` package:
#
#     docker build -f worker/Dockerfile -t dataforseo-claude-worker .
#
# Railway: set Root Directory = repo root, Dockerfile Path = worker/Dockerfile.

FROM python:3.11-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System deps. Minimal: ReportLab + Supabase client need none beyond libc.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first so the layer cache survives source edits.
COPY worker/pyproject.toml ./
RUN pip install --upgrade pip \
    && pip install \
        "fastapi>=0.115.0" \
        "uvicorn[standard]>=0.32.0" \
        "anthropic>=0.40.0" \
        "supabase>=2.10.0" \
        "pydantic>=2.9.0" \
        "httpx>=0.27.0" \
        "python-dotenv>=1.0.0" \
        "reportlab>=4.0.0"

# Copy worker source modules into /app (the cwd, already on sys.path).
COPY worker/main.py worker/agent.py worker/tools.py worker/steps.py \
     worker/composite.py worker/system_prompts.py worker/path_setup.py \
     ./

# Copy the SEO library so ``from seo.scripts.<module> import cmd_<...>``
# resolves at runtime. Lives next to main.py inside /app.
COPY seo /app/seo

EXPOSE 8000

# Healthcheck so Railway / Trigger.dev can probe the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${PORT:-8000}/health || exit 1

# Bind to 0.0.0.0 and respect Railway's $PORT.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
