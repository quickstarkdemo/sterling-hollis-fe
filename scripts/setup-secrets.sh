#!/bin/bash

set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login"
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "Usage: $0 <env-file>"
  exit 1
fi

ENV_FILE="$1"

if [ ! -f "$ENV_FILE" ]; then
  echo "Environment file not found: $ENV_FILE"
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
SECRET_COUNT=0
SKIPPED_COUNT=0

while IFS= read -r line || [ -n "$line" ]; do
  if [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]]; then
    continue
  fi

  if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
    KEY="${BASH_REMATCH[1]}"
    VALUE="${BASH_REMATCH[2]}"
    VALUE=$(echo "$VALUE" | sed 's/^["'\'']\|["'\'']$//g')

    if [[ -z "$VALUE" || "$VALUE" =~ ^(your-|sk-your-|secret_your-) ]]; then
      echo "Skipping $KEY"
      ((SKIPPED_COUNT+=1))
      continue
    fi

    echo "Setting secret: $KEY"
    echo "$VALUE" | gh secret set "$KEY" --repo "$REPO"
    ((SECRET_COUNT+=1))
  fi
done < "$ENV_FILE"

echo "Uploaded $SECRET_COUNT secrets"
echo "Skipped $SKIPPED_COUNT entries"
