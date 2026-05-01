#!/bin/bash

set -euo pipefail

ENV_FILE="${1:-.env}"
BUMP="${BUMP:-patch}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: $ENV_FILE"
  exit 1
fi

command -v git >/dev/null 2>&1 || { echo "git is required"; exit 1; }
command -v gh >/dev/null 2>&1 || { echo "gh is required"; exit 1; }

required=("DOCKERHUB_USER" "DOCKERHUB_TOKEN" "DOCKERHUB_IMAGE")
for key in "${required[@]}"; do
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    echo "Missing required key: $key"
    exit 1
  fi
done

current_version="$(tr -d '[:space:]' < VERSION 2>/dev/null || echo "0.1.0")"
IFS='.' read -r major minor patch <<< "$current_version"
major="${major:-0}"
minor="${minor:-1}"
patch="${patch:-0}"

case "$BUMP" in
  major) major=$((major + 1)); minor=0; patch=0 ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  patch) patch=$((patch + 1)) ;;
  none) ;;
  *) echo "Unsupported BUMP=$BUMP"; exit 1 ;;
esac

next_version="${major}.${minor}.${patch}"
if [[ "$BUMP" != "none" ]]; then
  echo "$next_version" > VERSION
  echo "Updated VERSION: $current_version -> $next_version"
fi

scripts/setup-secrets.sh "$ENV_FILE"

git add VERSION package.json package-lock.json index.html vite.config.js .eslintrc.cjs .gitignore .dockerignore Dockerfile README.md .env.example src docker deploy .github scripts examples

if git diff --cached --quiet; then
  echo "No staged changes. Triggering workflow manually."
  gh workflow run deploy-self-hosted.yaml
  exit 0
fi

commit_message="deploy(frontend): storefront updates v$(tr -d '[:space:]' < VERSION)"
git commit -m "$commit_message"
git push origin "$(git branch --show-current)"
echo "Deployment push complete. Monitor GitHub Actions for progress."
