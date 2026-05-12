# Sterling-Hollis Datadog Dashboard

This directory contains an importable Datadog dashboard payload for **Sterling-Hollis Storefront Health**.

The dashboard is scoped around:

- Frontend RUM for `service:sterling-hollis-fe`
- Backend logs/APM for `service:sterling-hollis-be`
- LLM Observability metrics for `ml_app:sterling-hollis-be`
- Network Path widgets for Sterling-Hollis, OpenAI, and Pinecone targets when tests exist

Create it with:

```bash
DD_API_KEY=... DD_APP_KEY=... ops/datadog/create-dashboard.sh
```

Set `DD_SITE` if the account is not on `datadoghq.com`.

The default dashboard time range should be set to the last 7 days in the Datadog UI after import. If the Network Path section is empty, attach or create Network Path tests for `sterling-hollis.quickstark.com`, `sterling-hollis-be.quickstark.com`, OpenAI, and Pinecone.

## Static asset 404 triage

The dashboard separates real browser asset failures from nginx probe noise:

- **Actionable Browser Static 404s** uses RUM resource events for JS/CSS/SVG
  requests returning `404`. Treat any non-zero value here as a likely broken
  frontend build, stale cache, or bad asset reference.
- **Probe-Style Nginx Static 404s** shows direct nginx 404 logs for guessed
  static paths. Requests with no page referrer, such as `/auth.js`,
  `/twint_ch.js`, `/qr_modal.js`, `/message.js`, `/support_parent.css`, or
  `/bot-connect.js`, should not be classified as a broken deploy unless they
  also appear as RUM resource 404s from real storefront sessions.
