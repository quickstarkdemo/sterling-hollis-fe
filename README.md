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
- `/sign-in/*` - Clerk-hosted storefront sign-in/sign-up flow
- `/style-finder` - image upload, backend visual analysis, and image recommendations
- `/catalog-studio` - protected catalog authoring, image review, and publication

## Scripts

```bash
npm run lint
npm run build
npm run preview
```

## Deployment

The production image builds the Vite app and serves `dist/` from Nginx. Runtime
`VITE_*` values are injected by `docker/entrypoint.sh`, mirroring the
`demo-gallery` deployment pattern. The GitHub Actions deploy workflow sets
`VITE_RELEASE` from `VERSION` plus the short commit SHA, so `/config.json` and
Datadog RUM should report the deployed build instead of `local`.

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
- `VITE_DATADOG_SESSION_SAMPLE_RATE`
- `VITE_DATADOG_REPLAY_SAMPLE_RATE`
- `VITE_DATADOG_ENABLE_LOCAL`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_DEMO_OBSERVABILITY_UI`
- `VITE_CATALOG_STUDIO_FALLBACK_PRODUCT_ID`
- `FRONTEND_PORT`

`FRONTEND_PORT` defaults to `45173`. It must be a free host port and must not
overlap the backend `API_PORT` or another container's published port.

For production, leave `VITE_API_URL` unset/empty so the browser uses same-origin
`/api` requests through the frontend Nginx proxy. Set `VITE_API_PROXY_TARGET` to
the backend origin.

Set `VITE_CLERK_PUBLISHABLE_KEY` to enable storefront login. Production
deployments must use a Clerk live publishable key (`pk_live_*`); the deploy
workflow rejects production runs configured with a development key (`pk_test_*`).
Clerk controls which strategies appear in the prebuilt sign-in UI, so enable
Google and email for this application in the Clerk Dashboard.

Set `VITE_DEMO_OBSERVABILITY_UI=true` only for demo/operator environments that
need the signed-in user menu control for backend latency and error injection.

Set `VITE_CATALOG_STUDIO_FALLBACK_PRODUCT_ID` to a stable published `cat_...`
product that the presenter can use if a live provider is unavailable. The value
is public operational metadata exposed in `/config.json`; it must never contain
a credential or private draft identifier.

Datadog browser monitoring is disabled on `localhost` by default to avoid local
dev reloads polluting RUM sessions. Set `VITE_DATADOG_ENABLE_LOCAL=true` only
when intentionally testing RUM from a local browser. `VITE_DATADOG_REPLAY_SAMPLE_RATE`
defaults to `100`, so every sampled RUM session is replay-eligible.

For static asset 404 triage, use RUM resource errors as the actionable signal.
Direct nginx 404s for guessed filenames such as `/auth.js`, `/twint_ch.js`, or
`/bot-connect.js` with no page referrer are internet probe noise unless a
matching RUM resource 404 appears from a real storefront session.

Deploy helper:

```bash
scripts/deploy.sh .env
```

Set `BUMP=minor` or `BUMP=none` to control version increments.

## Catalog Studio presenter preflight

The mocked contract suite runs in CI with `npm test`; it does not prove the
state of Clerk, OpenAI providers, the image worker, object storage, or ChatGPT.
Before a customer session, complete the deployed-system checklist and choose the
appropriate talk track in [the Catalog Studio presenter guide](docs/openai-catalog-studio-demo.md).
