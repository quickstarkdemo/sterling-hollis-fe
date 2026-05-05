#!/usr/bin/env bash
set -euo pipefail

dashboard_file="${1:-ops/datadog/sterling-hollis-storefront-health.dashboard.json}"
dd_site="${DD_SITE:-datadoghq.com}"

if [[ ! -f "$dashboard_file" ]]; then
  echo "Dashboard file not found: $dashboard_file" >&2
  exit 1
fi

if [[ -z "${DD_API_KEY:-}" || -z "${DD_APP_KEY:-}" ]]; then
  echo "DD_API_KEY and DD_APP_KEY must be set to create the Datadog dashboard." >&2
  exit 1
fi

api_url="https://api.${dd_site}/api/v1/dashboard"
response_file="$(mktemp)"
status_code="$(
  curl --silent --show-error --output "$response_file" --write-out "%{http_code}" \
    --request POST "$api_url" \
    --header "Content-Type: application/json" \
    --header "DD-API-KEY: ${DD_API_KEY}" \
    --header "DD-APPLICATION-KEY: ${DD_APP_KEY}" \
    --data-binary "@${dashboard_file}"
)"

if [[ "$status_code" != 2* ]]; then
  echo "Datadog dashboard creation failed with HTTP ${status_code}." >&2
  python3 -m json.tool "$response_file" >&2 || cat "$response_file" >&2
  rm -f "$response_file"
  exit 1
fi

python3 - "$response_file" "$dd_site" <<'PY'
import json
import sys

response_path, dd_site = sys.argv[1], sys.argv[2]
with open(response_path, "r", encoding="utf-8") as fh:
    data = json.load(fh)

dashboard_id = data.get("id")
url = data.get("url") or (f"https://app.{dd_site}/dashboard/{dashboard_id}" if dashboard_id else "")
print(f"Created dashboard: {data.get('title', dashboard_id)}")
if dashboard_id:
    print(f"Dashboard ID: {dashboard_id}")
if url:
    print(f"URL: {url}")
PY

rm -f "$response_file"
