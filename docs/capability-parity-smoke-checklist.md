# Capability Parity Smoke Checklist

Use this after deploy when validating the unified backend capability contract
from the frontend. Record product IDs and releases in meeting notes; never copy
credentials, private drafts, provider payloads, or unapproved customer-private
text.

## Storefront Chat

- Open a published product page as a shopper.
- Ask about availability or product details.
- Confirm the UI stays shopper-safe and does not call or expose admin routes.
- With diagnostics enabled only, confirm capability metadata uses shopper/public
  capability vocabulary.

## Catalog Studio

- Sign in with a Catalog Studio account.
- Confirm product list uses the explicit compatibility list dependency while
  product detail, draft, readiness, preview, and publish use current v3
  authoring flows.
- Ask a text assistant question and a bounded voice readout.
- Confirm current read/proposal voice tools target realtime v3 routing and
  legacy draft create/refine behavior is described as compatibility only.
- Archive only through the current v2 archive exception.

## Trace Tray

- Enable Developer tools and perform one storefront chat action and one Catalog
  Studio assistant/action.
- Open the trace tray and inspect each trace.
- Confirm capability id, surface, and status appear for both shopper and admin
  actions.
- For the storefront chat trace, open **Chat** and confirm the visible customer
  input and assistant response match the screen conversation.
- Confirm trace JSON and inspector views do not expose system prompts, raw
  provider payloads, credentials, audio, SDP, hidden reasoning, or private draft
  data.
- Confirm trace controls remain unavailable without an authorized session and
  `api_traces.configured`.

## MCP / ChatGPT

- Use the public or shopper MCP persona bundle for storefront product discovery.
- Use the catalog-admin bundle only for admin validation.
- Confirm associate/executive bundles expose persona-scoped readouts only.
- Confirm send-capable bundles require explicit approval policy and are not
  exposed as normal shopper/admin UI affordances.
