#!/usr/bin/env bash
set -euo pipefail

DEFAULT_ENV_FILE=".env"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_STATE_DIR="$PROJECT_ROOT/.deploy"
RELEASE_BRIEF_FILE="$DEPLOY_STATE_DIR/release-brief.md"
RELEASE_BRIEF_USAGE_FILE="$DEPLOY_STATE_DIR/release-brief.last-used.sha256"
DEPLOY_ENV_FILE="$DEFAULT_ENV_FILE"
DEPLOY_VERSION_OVERRIDE=""
DEPLOY_BUMP_OVERRIDE="patch"
DEPLOY_NON_INTERACTIVE=0
DEPLOY_WORKFLOW_FILE="deploy-self-hosted.yaml"
DEPLOY_VERSION_FROM=""
DEPLOY_VERSION_TO=""
DEPLOY_VERSION_BUMP_TYPE="unknown"

REQUIRED_ENV_KEYS=(
  "DOCKERHUB_USER"
  "DOCKERHUB_TOKEN"
  "DOCKERHUB_IMAGE"
  "FRONTEND_PORT"
)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_step() { echo -e "${BLUE}$1${NC}"; }
print_success() { echo -e "${GREEN}$1${NC}"; }
print_warning() { echo -e "${YELLOW}$1${NC}"; }
print_error() { echo -e "${RED}$1${NC}"; }

usage() {
  cat <<'EOF'
Usage: scripts/deploy.sh [env_file] [options]

Options:
  --env-file <path>         Environment file path (default: .env)
  --version <x.y.z>         Explicit version override for this run
  --bump <major|minor|patch|none>
                            Auto bump strategy when --version is not provided (default: patch)
  --non-interactive, -y     Run without prompts
  --workflow <filename>     Workflow file for manual dispatch
  --help, -h                Show this help
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env-file)
        [[ $# -ge 2 ]] || { print_error "Missing value for --env-file"; exit 1; }
        DEPLOY_ENV_FILE="$2"
        shift 2
        ;;
      --version)
        [[ $# -ge 2 ]] || { print_error "Missing value for --version"; exit 1; }
        DEPLOY_VERSION_OVERRIDE="$2"
        shift 2
        ;;
      --bump)
        [[ $# -ge 2 ]] || { print_error "Missing value for --bump"; exit 1; }
        DEPLOY_BUMP_OVERRIDE="$2"
        shift 2
        ;;
      --workflow)
        [[ $# -ge 2 ]] || { print_error "Missing value for --workflow"; exit 1; }
        DEPLOY_WORKFLOW_FILE="$2"
        shift 2
        ;;
      --non-interactive|-y)
        DEPLOY_NON_INTERACTIVE=1
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      -*)
        print_error "Unknown option: $1"
        usage
        exit 1
        ;;
      *)
        if [[ "$DEPLOY_ENV_FILE" == "$DEFAULT_ENV_FILE" ]]; then
          DEPLOY_ENV_FILE="$1"
          shift
        else
          print_error "Unexpected positional argument: $1"
          usage
          exit 1
        fi
        ;;
    esac
  done
}

hash_file() {
  local file_path="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file_path" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file_path" | awk '{print $1}'
  else
    print_error "Either shasum or sha256sum is required"
    exit 1
  fi
}

hash_text() {
  local text="$1"
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$text" | shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$text" | sha256sum | awk '{print $1}'
  else
    print_error "Either shasum or sha256sum is required"
    exit 1
  fi
}

env_state_file() {
  local env_file="$1"
  local env_abs_path
  env_abs_path="$(cd "$(dirname "$env_file")" && pwd)/$(basename "$env_file")"
  echo "$DEPLOY_STATE_DIR/env-sync-$(hash_text "$env_abs_path").sha256"
}

prompt_yes_no() {
  local prompt="$1"
  local default="${2:-n}"
  local default_label="no"
  [[ "$default" == "y" ]] && default_label="yes"

  if [[ "$DEPLOY_NON_INTERACTIVE" -eq 1 ]]; then
    print_step "Non-interactive: ${prompt} -> ${default_label}"
    [[ "$default" == "y" ]] && return 0 || return 1
  fi

  if [[ "$default" == "y" ]]; then
    prompt="$prompt [Y/n]: "
  else
    prompt="$prompt [y/N]: "
  fi

  while true; do
    read -r -p "$prompt" yn
    case "$yn" in
      [Yy]*) return 0 ;;
      [Nn]*) return 1 ;;
      "") [[ "$default" == "y" ]] && return 0 || return 1 ;;
      *) echo "Please answer yes or no." ;;
    esac
  done
}

env_value() {
  local env_file="$1"
  local key="$2"
  local value
  value="$(grep -E "^${key}=" "$env_file" | tail -n 1 | cut -d '=' -f2- || true)"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

validate_dockerhub_image() {
  local image="$1"
  local lowercase_image
  lowercase_image="$(printf '%s' "$image" | tr '[:upper:]' '[:lower:]')"

  if [[ "$image" != "$lowercase_image" ]]; then
    print_error "DOCKERHUB_IMAGE must be lowercase: $image"
    exit 1
  fi
  if [[ "$image" != */* ]]; then
    print_error "DOCKERHUB_IMAGE must include a namespace, for example quickstark/sterling-hollis-fe"
    exit 1
  fi
  if [[ "$image" == *:* ]]; then
    print_error "DOCKERHUB_IMAGE should not include a tag; the workflow adds tags."
    exit 1
  fi
  if [[ ! "$image" =~ ^[a-z0-9]+([._-][a-z0-9]+)*/[a-z0-9]+([._-][a-z0-9]+)*$ ]]; then
    print_error "DOCKERHUB_IMAGE has an invalid Docker Hub repository format: $image"
    exit 1
  fi
}

validate_env_file() {
  local env_file="$1"
  local key
  local value
  print_step "Validating $env_file..."

  for key in "${REQUIRED_ENV_KEYS[@]}"; do
    if ! grep -qE "^${key}=" "$env_file"; then
      print_error "Missing required key: $key"
      exit 1
    fi
    value="$(env_value "$env_file" "$key")"
    if [[ -z "$value" ]]; then
      print_error "Required key is empty: $key"
      exit 1
    fi
  done

  validate_dockerhub_image "$(env_value "$env_file" "DOCKERHUB_IMAGE")"
}

ensure_release_brief_file() {
  if [[ -f "$RELEASE_BRIEF_FILE" ]]; then
    return
  fi
  mkdir -p "$DEPLOY_STATE_DIR"
  cat > "$RELEASE_BRIEF_FILE" <<'EOF'
# Release Brief
Version:
Commit:
Summary:
-
EOF
}

increment_version_by_bump() {
  local version="$1"
  local bump="$2"
  local major minor patch
  IFS='.' read -r major minor patch <<< "$version"
  major="${major:-0}"
  minor="${minor:-1}"
  patch="${patch:-0}"

  case "$bump" in
    none) ;;
    major) major=$((10#$major + 1)); minor=0; patch=0 ;;
    minor) minor=$((10#$minor + 1)); patch=0 ;;
    patch) patch=$((10#$patch + 1)) ;;
    *) print_error "Unsupported bump strategy: $bump"; exit 1 ;;
  esac

  echo "${major}.${minor}.${patch}"
}

compare_versions() {
  local current="$1"
  local target="$2"
  local -a current_parts target_parts
  local max_len=0
  local i
  IFS='.' read -r -a current_parts <<< "$current"
  IFS='.' read -r -a target_parts <<< "$target"
  [[ "${#target_parts[@]}" -gt "$max_len" ]] && max_len="${#target_parts[@]}"
  [[ "${#current_parts[@]}" -gt "$max_len" ]] && max_len="${#current_parts[@]}"
  for ((i = 0; i < max_len; i += 1)); do
    local cur_part="${current_parts[$i]:-0}"
    local new_part="${target_parts[$i]:-0}"
    if ((10#$new_part > 10#$cur_part)); then echo "gt"; return; fi
    if ((10#$new_part < 10#$cur_part)); then echo "lt"; return; fi
  done
  echo "eq"
}

infer_bump_type() {
  local current="$1"
  local target="$2"
  local direction
  if [[ ! "$current" =~ ^[0-9]+(\.[0-9]+)+$ || ! "$target" =~ ^[0-9]+(\.[0-9]+)+$ ]]; then
    echo "custom"
    return
  fi
  direction="$(compare_versions "$current" "$target")"
  [[ "$direction" == "eq" ]] && { echo "unchanged"; return; }
  [[ "$direction" == "lt" ]] && { echo "downgrade"; return; }
  if [[ "${target%%.*}" != "${current%%.*}" ]]; then
    echo "major"
  elif [[ "$(cut -d. -f2 <<< "$target")" != "$(cut -d. -f2 <<< "$current")" ]]; then
    echo "minor"
  else
    echo "patch"
  fi
}

set_version() {
  local current_version
  local new_version
  current_version="$(tr -d '[:space:]' < VERSION 2>/dev/null || true)"
  current_version="${current_version:-0.1.0}"
  new_version="${DEPLOY_VERSION_OVERRIDE:-$(increment_version_by_bump "$current_version" "$DEPLOY_BUMP_OVERRIDE")}"

  if [[ ! "$new_version" =~ ^[0-9]+(\.[0-9]+)+$ ]]; then
    print_error "Invalid version format: $new_version"
    exit 1
  fi

  DEPLOY_VERSION_FROM="$current_version"
  DEPLOY_VERSION_TO="$new_version"
  DEPLOY_VERSION_BUMP_TYPE="$(infer_bump_type "$current_version" "$new_version")"
  print_step "Detected version bump type: $DEPLOY_VERSION_BUMP_TYPE ($current_version -> $new_version)"

  if [[ "$DEPLOY_VERSION_BUMP_TYPE" == "downgrade" ]] && ! prompt_yes_no "Continue with downgrade?" "n"; then
    print_error "Version downgrade cancelled."
    exit 1
  fi
  if [[ "$DEPLOY_VERSION_BUMP_TYPE" == "major" ]] && ! prompt_yes_no "Continue with major bump?" "y"; then
    print_error "Major version bump cancelled."
    exit 1
  fi

  if [[ "$new_version" != "$current_version" ]]; then
    echo "$new_version" > VERSION
    print_success "Updated VERSION to $new_version"
  else
    print_step "Keeping VERSION at $current_version"
  fi
}

upload_env() {
  local env_file="$1"
  local state_file
  local current_hash
  local previous_hash=""
  state_file="$(env_state_file "$env_file")"
  current_hash="$(hash_file "$env_file")"
  [[ -f "$state_file" ]] && previous_hash="$(cut -d ' ' -f1 < "$state_file")"

  if [[ -n "$previous_hash" && "$previous_hash" == "$current_hash" ]]; then
    print_step "Environment file unchanged; skipping GitHub env sync."
    return
  fi

  print_step "Syncing GitHub Actions secrets from $env_file..."
  "$SCRIPT_DIR/setup-secrets.sh" "$env_file"
  if [[ -x "$SCRIPT_DIR/setup-vars.sh" ]]; then
    print_step "Syncing GitHub Actions variables from $env_file..."
    "$SCRIPT_DIR/setup-vars.sh" "$env_file"
  fi
  mkdir -p "$DEPLOY_STATE_DIR"
  printf '%s  %s\n' "$current_hash" "$env_file" > "$state_file"
}

generate_commit_message() {
  local current_version
  local staged_files
  current_version="$(tr -d '[:space:]' < VERSION 2>/dev/null || true)"
  staged_files="$(git diff --cached --name-only)"
  if [[ -z "$staged_files" ]]; then
    echo "Deploy sterling-hollis-fe"
  elif [[ "$staged_files" == "VERSION" ]]; then
    echo "chore: bump VERSION to ${current_version}"
  else
    echo "deploy(frontend): staged changes (v${current_version})"
  fi
}

generate_commit_body() {
  local current_version
  local staged_count
  local staged_paths
  current_version="$(tr -d '[:space:]' < VERSION 2>/dev/null || true)"
  staged_count="$(git diff --cached --name-only | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"
  staged_paths="$(git diff --cached --name-only | sed '/^[[:space:]]*$/d' | head -n 12 | sed 's/^/- /')"
  cat <<EOF
Release metadata:
- app: sterling-hollis-fe
- version: ${current_version:-n/a}
- version bump: ${DEPLOY_VERSION_BUMP_TYPE} (${DEPLOY_VERSION_FROM:-n/a} -> ${DEPLOY_VERSION_TO:-n/a})
- staged files: ${staged_count:-0}

Staged paths:
${staged_paths:-- (none)}
EOF
}

write_deploy_notes() {
  local commit_subject="$1"
  local commit_body="$2"
  local notes_file="$DEPLOY_STATE_DIR/deploy-notes-latest.md"
  mkdir -p "$DEPLOY_STATE_DIR"
  {
    echo "# Deploy Notes"
    echo ""
    echo "- Generated UTC: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
    echo "- Branch: $(git branch --show-current)"
    echo "- Base SHA: $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    echo "- Proposed commit: ${commit_subject}"
    echo ""
    echo "## Staged files"
    git diff --cached --name-status | sed 's/^/- /'
    echo ""
    echo "## Proposed Commit Body"
    echo ""
    printf '%s\n' "$commit_body" | sed 's/^/> /'
  } > "$notes_file"
  echo "$notes_file"
}

commit_and_push() {
  local unstaged_tracked
  local untracked_files
  local commit_message
  local auto_commit_message
  local auto_commit_body
  local notes_file

  git status --short
  unstaged_tracked="$(git diff --name-only)"
  untracked_files="$(git ls-files --others --exclude-standard)"

  if [[ -n "$untracked_files" ]]; then
    print_error "Refusing to deploy with untracked files present."
    echo "$untracked_files"
    echo "Stage or ignore these files intentionally before deploying."
    exit 1
  fi

  if [[ -n "$unstaged_tracked" ]]; then
    if [[ "$unstaged_tracked" == "VERSION" ]]; then
      git add VERSION
    else
      print_error "Refusing to deploy with unstaged tracked changes."
      echo "$unstaged_tracked"
      echo "Stage exactly what you want deployed, then rerun the script."
      exit 1
    fi
  fi

  if git diff --cached --quiet; then
    print_warning "No staged changes to commit."
    if prompt_yes_no "Trigger deploy workflow manually instead?" "y"; then
      gh workflow run "$DEPLOY_WORKFLOW_FILE"
      print_success "Workflow dispatch requested."
      return
    fi
    print_warning "Skipping push."
    return
  fi

  auto_commit_message="$(generate_commit_message)"
  auto_commit_body="$(generate_commit_body)"
  notes_file="$(write_deploy_notes "$auto_commit_message" "$auto_commit_body")"
  print_step "Generated deploy notes: ${notes_file#$PROJECT_ROOT/}"

  if [[ "$DEPLOY_NON_INTERACTIVE" -eq 1 ]]; then
    commit_message="$auto_commit_message"
  else
    read -r -p "Commit message [$auto_commit_message]: " commit_message
    commit_message="${commit_message:-$auto_commit_message}"
  fi

  git commit -m "$commit_message" -m "$auto_commit_body"
  git push origin "$(git branch --show-current)"
}

check_prerequisites() {
  print_step "Checking prerequisites..."
  command -v git >/dev/null 2>&1 || { print_error "git is required"; exit 1; }
  command -v gh >/dev/null 2>&1 || { print_error "gh is required"; exit 1; }
  if ! gh auth status >/dev/null 2>&1; then
    print_error "GitHub CLI is not authenticated"
    echo "Run: gh auth login"
    exit 1
  fi
}

main() {
  cd "$PROJECT_ROOT"
  parse_args "$@"
  [[ -f "$DEPLOY_ENV_FILE" ]] || { print_error "Environment file not found: $DEPLOY_ENV_FILE"; exit 1; }
  check_prerequisites
  ensure_release_brief_file
  validate_env_file "$DEPLOY_ENV_FILE"
  set_version
  upload_env "$DEPLOY_ENV_FILE"

  if prompt_yes_no "Commit and push changes to trigger deployment?" "y"; then
    commit_and_push
    print_success "Deployment push complete. Monitor GitHub Actions for progress."
  else
    print_warning "Environment sync complete. Commit/push skipped."
  fi
}

main "$@"
