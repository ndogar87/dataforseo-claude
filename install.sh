#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# dataforseo-claude — Claude Code Skill Installer
# Installs the SEO Agency Killer skill pack with an isolated
# Python virtual environment.
# ============================================================

REPO_URL="https://github.com/zubair-trabzada/dataforseo-claude.git"
CLAUDE_DIR="${HOME}/.claude"
SKILLS_DIR="${CLAUDE_DIR}/skills"
AGENTS_DIR="${CLAUDE_DIR}/agents"
INSTALL_DIR="${SKILLS_DIR}/seo"
VENV_DIR="${INSTALL_DIR}/.venv"
VENV_PY="${VENV_DIR}/bin/python3"
# Tilde-form path for patched references inside skill/agent .md files.
# Claude Code's Bash expands the tilde at run-time. Keep it literal.
# shellcheck disable=SC2088
VENV_MD_PY='~/.claude/skills/seo/.venv/bin/python3'
TEMP_DIR=$(mktemp -d)

INTERACTIVE=true
if [ ! -t 0 ]; then INTERACTIVE=false; fi

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; NC='\033[0m'

print_header() {
  echo ""
  echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║   dataforseo-claude — Skill Installer      ║${NC}"
  echo -e "${BLUE}║   SEO Agency Killer for Claude Code        ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
  echo ""
}

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠ $1${NC}"; }
print_error()   { echo -e "${RED}✗ $1${NC}"; }
print_info()    { echo -e "${BLUE}→ $1${NC}"; }

cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

sed_inplace() {
  local pattern="$1" file="$2"
  sed -i.bak "$pattern" "$file" && rm -f "${file}.bak"
}

main() {
  print_header

  # ---- Prerequisites ----
  print_info "Checking prerequisites..."

  if ! command -v git &> /dev/null; then
    print_error "Git is required. Install: https://git-scm.com/downloads"
    exit 1
  fi
  print_success "Git found: $(git --version)"

  PYTHON_CMD=""
  if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
  elif command -v python &> /dev/null; then
    PY_VERSION=$(python --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
    if [ -n "$PY_VERSION" ]; then
      MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
      MINOR=$(echo "$PY_VERSION" | cut -d. -f2)
      if [ "$MAJOR" -ge 3 ] && [ "$MINOR" -ge 8 ]; then PYTHON_CMD="python"; fi
    fi
  fi
  if [ -z "$PYTHON_CMD" ]; then
    print_error "Python 3.8+ is required."
    echo "  Install: https://www.python.org/downloads/"
    exit 1
  fi
  print_success "Python found: $($PYTHON_CMD --version)"

  if ! command -v claude &> /dev/null; then
    print_warning "Claude Code CLI not found in PATH."
    echo "  Install: npm install -g @anthropic-ai/claude-code"
    if [ "$INTERACTIVE" = true ]; then
      read -p "Continue anyway? (y/n): " -n 1 -r; echo ""
      [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
    else
      print_info "Non-interactive — continuing."
    fi
  else
    print_success "Claude Code CLI found"
  fi

  USE_UV=false
  if command -v uv &> /dev/null; then
    USE_UV=true
    print_success "'uv' detected — using it for a faster install"
  fi

  # ---- Directories ----
  print_info "Creating directories..."
  mkdir -p "$SKILLS_DIR" "$AGENTS_DIR" "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR/scripts" "$INSTALL_DIR/schema" "$INSTALL_DIR/hooks" "$INSTALL_DIR/output"
  print_success "Directory structure created"

  # ---- Source: local checkout or clone ----
  print_info "Fetching skill files..."
  SCRIPT_DIR=""
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" != "bash" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || true
  fi
  if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/seo/SKILL.md" ]; then
    print_info "Installing from local directory..."
    SOURCE_DIR="$SCRIPT_DIR"
  else
    print_info "Cloning from repository..."
    git clone --depth 1 "$REPO_URL" "$TEMP_DIR/repo" || {
      print_error "Failed to clone repository. Check your internet connection."
      exit 1
    }
    SOURCE_DIR="${TEMP_DIR}/repo"
  fi

  # ---- Install Main Skill ----
  print_info "Installing main /seo skill..."
  cp -r "$SOURCE_DIR/seo/"* "$INSTALL_DIR/"
  print_success "Main skill installed → ${INSTALL_DIR}/"

  # ---- Install Sub-Skills ----
  print_info "Installing sub-skills..."
  SKILL_COUNT=0
  for skill_dir in "$SOURCE_DIR/skills"/*/; do
    if [ -d "$skill_dir" ]; then
      skill_name=$(basename "$skill_dir")
      target_dir="${SKILLS_DIR}/${skill_name}"
      mkdir -p "$target_dir"
      cp -r "$skill_dir"* "$target_dir/"
      SKILL_COUNT=$((SKILL_COUNT + 1))
      print_success "  ${skill_name}"
    fi
  done
  echo "  → ${SKILL_COUNT} sub-skills installed"

  # ---- Install Agents ----
  print_info "Installing subagents..."
  AGENT_COUNT=0
  for agent_file in "$SOURCE_DIR/agents/"*.md; do
    if [ -f "$agent_file" ]; then
      cp "$agent_file" "$AGENTS_DIR/"
      AGENT_COUNT=$((AGENT_COUNT + 1))
      print_success "  $(basename "$agent_file")"
    fi
  done
  echo "  → ${AGENT_COUNT} subagents installed"

  # ---- .env handling ----
  ENV_TARGET="${INSTALL_DIR}/.env"
  if [ -f "$ENV_TARGET" ]; then
    print_info ".env already exists at ${ENV_TARGET} — leaving untouched."
  else
    cp "$SOURCE_DIR/.env.example" "$ENV_TARGET"
    chmod 600 "$ENV_TARGET" 2>/dev/null || true
    print_warning "Created ${ENV_TARGET} from template — ADD YOUR DATAFORSEO CREDENTIALS"
  fi

  # ---- Virtual Environment ----
  print_info "Creating isolated Python environment → ${VENV_DIR}"
  rm -rf "$VENV_DIR"
  if [ "$USE_UV" = true ]; then
    uv venv "$VENV_DIR" --python "$PYTHON_CMD" --quiet || { print_error "uv venv failed."; exit 1; }
  else
    if ! $PYTHON_CMD -m venv "$VENV_DIR" 2>/dev/null; then
      print_error "Failed to create virtual environment."
      echo "  Try:"
      echo "    • Debian/Ubuntu:  sudo apt install python3-venv"
      echo "    • Fedora/RHEL:    sudo dnf install python3-virtualenv"
      echo "    • Or install uv:  https://docs.astral.sh/uv/"
      exit 1
    fi
  fi
  print_success "Virtual environment created"

  # ---- Dependencies ----
  print_info "Installing Python dependencies..."
  if [ ! -f "$SOURCE_DIR/requirements.txt" ]; then
    print_warning "requirements.txt missing — skipping."
  elif [ "$USE_UV" = true ]; then
    uv pip install --python "$VENV_PY" -r "$SOURCE_DIR/requirements.txt" --quiet || {
      print_error "Failed to install dependencies via uv."; exit 1; }
  else
    "$VENV_PY" -m pip install --upgrade pip --quiet
    "$VENV_PY" -m pip install -r "$SOURCE_DIR/requirements.txt" --quiet || {
      print_error "Failed to install dependencies."; exit 1; }
  fi
  print_success "Dependencies installed (isolated venv)"

  cp "$SOURCE_DIR/requirements.txt" "$INSTALL_DIR/" 2>/dev/null || true

  # ---- Pin script shebangs to venv ----
  print_info "Pinning script shebangs..."
  SHEBANG_COUNT=0
  for f in "$INSTALL_DIR/scripts/"*.py; do
    [ -f "$f" ] || continue
    sed_inplace "1s|^#!.*|#!${VENV_PY}|" "$f"
    chmod +x "$f"
    SHEBANG_COUNT=$((SHEBANG_COUNT + 1))
  done
  print_success "${SHEBANG_COUNT} script(s) pinned"

  # ---- Patch markdown references ----
  print_info "Rewriting skill & agent paths..."
  patch_md() {
    local f="$1"
    sed_inplace 's|python3 ~/\.claude/skills/seo/scripts/|~/.claude/skills/seo/scripts/|g' "$f"
    sed_inplace "s|python3 -c |${VENV_MD_PY} -c |g" "$f"
    sed_inplace "s|python3 -m |${VENV_MD_PY} -m |g" "$f"
  }
  PATCH_COUNT=0
  for f in "$INSTALL_DIR/SKILL.md" "$SKILLS_DIR"/seo-*/SKILL.md "$AGENTS_DIR"/seo-*.md; do
    if [ -f "$f" ]; then patch_md "$f"; PATCH_COUNT=$((PATCH_COUNT + 1)); fi
  done
  print_success "${PATCH_COUNT} markdown file(s) rewritten"

  # ---- Verify ----
  echo ""
  print_info "Verifying installation..."
  VERIFY_OK=true
  verify() {
    local label="$1"; shift
    if "$@"; then print_success "$label"
    else print_error "$label missing"; VERIFY_OK=false; fi
  }
  agent_count=0
  for f in "$AGENTS_DIR"/seo-*.md; do
    [ -f "$f" ] && agent_count=$((agent_count + 1))
  done
  verify "Main skill file"      test -f "$INSTALL_DIR/SKILL.md"
  verify "Sub-skills directory" test -d "$SKILLS_DIR/seo-audit"
  verify "Agent files"          test "$agent_count" -gt 0
  verify "Utility scripts"      test -d "$INSTALL_DIR/scripts"
  verify "Schema templates"     test -d "$INSTALL_DIR/schema"
  verify "Venv interpreter"     test -x "$VENV_PY"
  verify ".env file"            test -f "$ENV_TARGET"

  if [ "$VERIFY_OK" = false ]; then
    echo ""; print_warning "One or more files are missing — install may be incomplete."
  fi

  # ---- Summary ----
  echo ""
  echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║          Installation Complete!            ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
  echo ""
  echo "  Installed to: ${INSTALL_DIR}"
  echo "  Venv:         ${VENV_DIR}"
  echo "  Skills:       ${SKILL_COUNT} sub-skills"
  echo "  Agents:       ${AGENT_COUNT} subagents"
  echo ""
  echo -e "${YELLOW}IMPORTANT — Add your DataForSEO credentials:${NC}"
  echo ""
  echo "  1. Sign up free: https://app.dataforseo.com/register"
  echo "  2. Edit:         ${ENV_TARGET}"
  echo "  3. Set:          DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD"
  echo ""
  echo -e "${BLUE}Quick Start:${NC}"
  echo ""
  echo "    /seo quick example.com"
  echo "    /seo audit example.com"
  echo "    /seo keywords \"keyword research\""
  echo "    /seo competitors example.com"
  echo "    /seo backlinks example.com"
  echo "    /seo content-gap you.com competitor.com"
  echo ""
  echo "  Documentation: https://github.com/zubair-trabzada/dataforseo-claude"
  echo ""
}

main "$@"
