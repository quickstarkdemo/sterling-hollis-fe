FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV VITE_API_URL=__VITE_API_URL__
ENV VITE_API_PROXY_TARGET=__VITE_API_PROXY_TARGET__
ENV VITE_DEFAULT_STORE_ID=__VITE_DEFAULT_STORE_ID__
ENV VITE_ENVIRONMENT=__VITE_ENVIRONMENT__
ENV VITE_DATADOG_APPLICATION_ID=__VITE_DATADOG_APPLICATION_ID__
ENV VITE_DATADOG_CLIENT_TOKEN=__VITE_DATADOG_CLIENT_TOKEN__
ENV VITE_DATADOG_SITE=__VITE_DATADOG_SITE__
ENV VITE_DATADOG_SERVICE=__VITE_DATADOG_SERVICE__
ENV VITE_RELEASE=__VITE_RELEASE__

RUN npm run build

FROM nginx:alpine

RUN apk add --no-cache gettext

COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/health || exit 1

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
