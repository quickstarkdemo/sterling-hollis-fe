#!/bin/sh
set -e

replace_env_vars() {
  echo "Injecting runtime environment variables..."
  for file in /usr/share/nginx/html/assets/*.js /usr/share/nginx/html/index.html; do
    if [ -f "$file" ]; then
      sed -i "s|__VITE_API_URL__|${VITE_API_URL:-http://localhost:8000}|g" "$file"
      sed -i "s|__VITE_API_PROXY_TARGET__|${VITE_API_PROXY_TARGET:-https://products-api.quickstark.com}|g" "$file"
      sed -i "s|__VITE_DEFAULT_STORE_ID__|${VITE_DEFAULT_STORE_ID:-}|g" "$file"
      sed -i "s|__VITE_ENVIRONMENT__|${VITE_ENVIRONMENT:-production}|g" "$file"
      sed -i "s|__VITE_DATADOG_APPLICATION_ID__|${VITE_DATADOG_APPLICATION_ID:-}|g" "$file"
      sed -i "s|__VITE_DATADOG_CLIENT_TOKEN__|${VITE_DATADOG_CLIENT_TOKEN:-}|g" "$file"
      sed -i "s|__VITE_DATADOG_SITE__|${VITE_DATADOG_SITE:-datadoghq.com}|g" "$file"
      sed -i "s|__VITE_DATADOG_SERVICE__|${VITE_DATADOG_SERVICE:-sterling-hollis-fe}|g" "$file"
      sed -i "s|__VITE_RELEASE__|${VITE_RELEASE:-local}|g" "$file"
    fi
  done

  sed -i "s|__VITE_API_PROXY_TARGET__|${VITE_API_PROXY_TARGET:-https://products-api.quickstark.com}|g" /etc/nginx/conf.d/default.conf
}

cat > /usr/share/nginx/html/config.json <<EOF
{
  "apiUrl": "${VITE_API_URL:-same-origin}",
  "apiProxyTarget": "${VITE_API_PROXY_TARGET:-https://products-api.quickstark.com}",
  "environment": "${VITE_ENVIRONMENT:-production}",
  "service": "${VITE_DATADOG_SERVICE:-sterling-hollis-fe}",
  "release": "${VITE_RELEASE:-local}"
}
EOF

echo "Starting Sterling Hollis frontend"
echo "API URL: ${VITE_API_URL:-same-origin}"
echo "API proxy target: ${VITE_API_PROXY_TARGET:-https://products-api.quickstark.com}"
echo "Service: ${VITE_DATADOG_SERVICE:-sterling-hollis-fe}"
echo "Release: ${VITE_RELEASE:-local}"

replace_env_vars

exec "$@"
