#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env}"
VAR_KEYS=(

)

if [[ "${#VAR_KEYS[@]}" -eq 0 ]]; then
  echo "No GitHub Actions variables configured for this project."
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE"
  exit 1
fi

SYNC_SET=0
SYNC_DELETED=0
SYNC_SKIPPED=0

array_contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
    KEY="${BASH_REMATCH[1]}"
    VALUE="${BASH_REMATCH[2]}"
    VALUE="${VALUE#\"}"
    VALUE="${VALUE%\"}"
    VALUE="${VALUE#\'}"
    VALUE="${VALUE%\'}"

    if ! array_contains "$KEY" "${VAR_KEYS[@]}"; then
      ((SYNC_SKIPPED += 1))
      continue
    fi

    if [[ -n "$VALUE" ]]; then
      gh variable set "$KEY" --body "$VALUE"
      echo "Set variable: $KEY"
      ((SYNC_SET += 1))
    else
      gh variable delete "$KEY" >/dev/null 2>&1 || true
      echo "Deleted variable if present: $KEY"
      ((SYNC_DELETED += 1))
    fi
  fi
done < "$ENV_FILE"

echo "Repository variables sync complete: set=$SYNC_SET deleted=$SYNC_DELETED skipped=$SYNC_SKIPPED"
