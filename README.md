# sterling-hollis-fe

Vite + React storefront for the Sterling Hollis retail/AI demo. The frontend is
a static browser app served by Nginx in production; all catalog,
recommendation, MCP, OpenAI, Pinecone, and Datadog backend behavior stays in the
FastAPI service.

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Default local API proxy target:

```text
http://localhost:8000
```

To use the deployed product API through the dev proxy:

```bash
VITE_API_URL= VITE_API_PROXY_TARGET=https://sterling-hollis-be.quickstark.com npm run dev
```

Leave `VITE_API_URL` empty for same-origin `/api` requests. This avoids browser
CORS issues by using the Vite dev proxy locally and the Nginx proxy in
production.

## App Routes

- `/` - retail home, category navigation, search, featured products, AI rail
- `/category/:category` - category product grid
- `/product/:productId` - product detail, variants, inventory, related products
- `/style-finder` - image upload, backend visual analysis, and image recommendations

## Scripts

```bash
npm run lint
npm run build
npm run preview
```

## Deployment

The production image builds the Vite app and serves `dist/` from Nginx. Runtime
`VITE_*` values are injected by `docker/entrypoint.sh`, mirroring the
`demo-gallery` deployment pattern.

Required deployment secrets:

- `DOCKERHUB_USER`
- `DOCKERHUB_TOKEN`
- `DOCKERHUB_IMAGE`

Useful runtime secrets:

- `VITE_API_URL`
- `VITE_API_PROXY_TARGET`
- `VITE_DEFAULT_STORE_ID`
- `VITE_ENVIRONMENT`
- `VITE_DATADOG_APPLICATION_ID`
- `VITE_DATADOG_CLIENT_TOKEN`
- `VITE_DATADOG_SITE`
- `VITE_DATADOG_SERVICE`
- `FRONTEND_PORT`

`FRONTEND_PORT` defaults to `45173`. It must be a free host port and must not
overlap the backend `API_PORT` or another container's published port.

For production, leave `VITE_API_URL` unset/empty so the browser uses same-origin
`/api` requests through the frontend Nginx proxy. Set `VITE_API_PROXY_TARGET` to
the backend origin.

Deploy helper:

```bash
scripts/deploy.sh .env
```

Set `BUMP=minor` or `BUMP=none` to control version increments.
