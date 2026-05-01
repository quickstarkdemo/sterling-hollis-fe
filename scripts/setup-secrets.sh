#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env}"
SECRET_KEYS=(
  "DOCKERHUB_USER"
  "DOCKERHUB_TOKEN"
  "DOCKERHUB_IMAGE"
  "FRONTEND_PORT"
  "APP_CONTAINER_NAME"
)
SKIP_KEYS=(

)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if ! command -v gh >/dev/null 2>&1; then
  echo -e "${RED}GitHub CLI (gh) is required${NC}"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo -e "${RED}GitHub CLI is not authenticated${NC}"
  echo "Run: gh auth login"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo -e "${RED}Environment file not found: $ENV_FILE${NC}"
  exit 1
fi

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
SECRET_COUNT=0
SKIPPED_COUNT=0

array_contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

validate_dockerhub_image() {
  local image="$1"
  local lowercase_image
  lowercase_image="$(printf '%s' "$image" | tr '[:upper:]' '[:lower:]')"
  if [[ "$image" != "$lowercase_image" || "$image" != */* || "$image" == *:* ]]; then
    echo -e "${RED}Invalid DOCKERHUB_IMAGE: $image. Expected namespace/repo with no tag.${NC}"
    exit 1
  fi
  if [[ ! "$image" =~ ^[a-z0-9]+([._-][a-z0-9]+)*/[a-z0-9]+([._-][a-z0-9]+)*$ ]]; then
    echo -e "${RED}DOCKERHUB_IMAGE has an invalid Docker Hub repository format: $image${NC}"
    exit 1
  fi
}

sync_key_value() {
  local key="$1"
  local value="$2"

  if array_contains "$key" "${SKIP_KEYS[@]}"; then
    ((SKIPPED_COUNT += 1))
    return
  fi

  if [[ "${#SECRET_KEYS[@]}" -gt 0 ]] && ! array_contains "$key" "${SECRET_KEYS[@]}"; then
    ((SKIPPED_COUNT += 1))
    return
  fi

  if [[ -z "$value" || "$value" =~ ^(your-|sk-your-|secret_your-|changeme) ]]; then
    echo -e "${YELLOW}Skipping $key (empty or placeholder)${NC}"
    ((SKIPPED_COUNT += 1))
    return
  fi

  if [[ "$key" == "DOCKERHUB_IMAGE" ]]; then
    validate_dockerhub_image "$value"
  fi

  echo -e "${GREEN}Setting secret: $key${NC}"
  printf '%s' "$value" | gh secret set "$key" --repo "$REPO"
  ((SECRET_COUNT += 1))
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
    sync_key_value "$KEY" "$VALUE"
  fi
done < "$ENV_FILE"

echo ""
echo -e "${GREEN}Uploaded $SECRET_COUNT secrets${NC}"
echo -e "${YELLOW}Skipped $SKIPPED_COUNT entries${NC}"
