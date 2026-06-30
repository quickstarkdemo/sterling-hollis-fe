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
- In Catalog Studio, ask the text assistant a product or inventory question,
  then open **Chat** and confirm the presenter/user request and assistant answer
  appear as visible conversation messages.
- In Catalog Studio, run a bounded realtime voice readout or draft command, then
  confirm **Chat** groups the presenter input and assistant/tool response into a
  single turn when the trace contains a stable turn id.
- Open **Graph**, select the visible conversation node, and confirm the inspector
  opens the same backing event or transcript artifact shown by **Chat**.
- Copy or export the trace JSON and confirm the top-level
  `visible_conversation` section lists the readable input/output messages while
  the original spans, events, and artifacts remain present.
- For expired traces, confirm `visible_conversation` reports metadata-only
  records and does not invent or expose transcript text.
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
