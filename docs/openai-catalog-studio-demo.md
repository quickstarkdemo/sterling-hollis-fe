# OpenAI Catalog Studio presenter guide

Catalog Studio is a protected production workflow inside the public Sterling
Hollis storefront. The presenter uses it to create, refine, review, and publish
one catalog product. The same published product then appears on the storefront,
in storefront chat, and through the existing ChatGPT/MCP product tools.

This guide separates repeatable CI coverage from live-system preflight. A green
frontend test run does not validate deployed credentials, provider availability,
the durable image worker, object storage, or ChatGPT discovery.

## Choose the presentation depth

### Executive path (5 minutes)

1. Start on the public storefront and point out that shopping remains anonymous.
2. Sign in and open **Catalog Studio** from the header or Clerk user menu.
3. Use the command center search, filters, and view toggle to find an existing
   product, or click **New product** to open the **Product inspector**.
4. In the inspector, upload the known-good supplier image bundle.
5. Accept one evidence-backed suggestion and reject another, explaining that AI
   proposals do not become product data until a merchant accepts them.
6. Open **Ask AI** for a read-only catalog question such as which store is low
   on stock. Then use the inspector's product chat or voice controls to stage a
   warmer description rewrite and accept the proposal.
7. Review readiness, moderate one synthetic customer review, and publish a
   merchant response only after approving the review.
8. Publish the product explicitly, open it on the storefront, and confirm the
   approved customer review and published response appear there.

Keep **Developer tools** off. Emphasize human approval, one catalog record, and
safe recovery rather than implementation details.

### Codex build path (10 minutes)

Use the executive path, then connect the shipped behavior to the repository
history: one GitHub issue and independently reviewable PR per plan unit, backend
contracts before consumers, and tests for authorization, moderation, recovery,
redaction, and publication. Do not imply that Codex bypassed code review or that
mocked tests validated live provider credentials.

### Trace path (15 minutes)

Use this path when the shared API trace capability is configured. Turn on
**Developer tools** from the Clerk profile menu, then open the compact bottom
**Dev Tools** tray. Perform these actions in order:

1. Create or refine a product draft from the **Product inspector**.
2. Open **Ask AI** and ask one read-only inventory or assortment question.
3. Upload supplier sources, generate suggestions, and accept or reject one
   proposal.
4. Generate and approve one reviewed image variant.
5. Publish the draft.
6. Open the public product page and send one storefront chat turn about the same
   product.

For each action, expand **Dev Tools**, select the most recent trace, and confirm
the root span name matches the user action, with child HTTP spans for the
backend calls. The selected trace should show only bounded IDs, endpoints,
statuses, and operational metadata. It must not show prompts, credentials, raw
review text, supplier file contents, audio, or private provider payloads.

For an offline walkthrough, load the sanitized scripted projection in
`docs/fixtures/catalog-chat-trace-replay.json` into the trace replay tooling or
use it as the source fixture for screenshots. The fixture contains stable demo
IDs only; it is not evidence that the live backend, stream, worker, or provider
paths succeeded.

## Deployed-system preflight

Run this checklist on the production origin no more than a few hours before the
session. Record the result and the product IDs in the meeting notes; do not add
credentials or Clerk tokens.

### 1. Runtime and public storefront

- Open `/frontend-health` and confirm `healthy`.
- Open `/config.json`; confirm the expected release, production environment,
  Clerk enabled, and a `catalogStudioFallbackProductId` when one is configured.
- Open `/health` and confirm the proxied backend is healthy.
- Browse the home page and one existing product while signed out.
- Confirm Catalog Studio is absent from public navigation and protected when
  `/catalog-studio` is entered directly.

### 2. Authorization and capabilities

- Sign in with the designated presenter account.
- Confirm Catalog Studio appears in both the header and Clerk user menu.
- Open the Studio and confirm the command center renders with **Ask AI**, **New
  product**, search, filters, product count, and view toggle controls.
- Confirm capability-dependent controls are available in the expected surfaces:
  **Ask AI** opens the assistant drawer, **New product** opens the Product
  inspector, voice controls appear when Realtime is configured, and **Dev
  Tools** appears only after **Developer tools** is enabled and the session
  advertises `api_traces.configured`. Treat unavailable capabilities as a
  live-system failure even if CI is green.

### 3. Text, moderation, and recovery

- Click **New product**, create a disposable test product with text in the
  **Product inspector**, and verify separate Responses, Moderation, and Catalog
  events through the trace tray when enabled.
- Submit a known policy-test instruction only if the meeting environment permits
  it; confirm no product draft or image controls appear for a blocked result.
- Use the operator latency/error controls only in an approved demo environment.
  Confirm retry preserves the current private draft, then reset the control.

### 4. Image worker and storage

- Start image generation and observe queued/running/succeeded states.
- Confirm the generated asset loads from deployed object storage.
- Approve the image and verify it remains attached to the expected draft version.
- If polling times out, use **Retry image status**; do not start duplicate jobs.

### 5. Voice

- Grant microphone access and start a short-lived voice session.
- Ask: **Which store is lowest on stock for this product?** Confirm the answer is
  grounded in the authorized inventory projection and changes no product state.
- Focus the description field and ask for a warmer rewrite. Confirm the target
  remains pinned to description and the result appears as a pending before/after
  proposal rather than changing the saved draft.
- Accept or reject the field proposal explicitly, then stop voice and confirm the
  draft remains editable with text.
- If Realtime fails, continue with text; do not spend meeting time debugging the
  microphone, SDP exchange, or ephemeral token.

### 6. Review moderation

- Open **Reviews** and select the synthetic five-star fixture from Maya R.
- Run **Analyze review** and explain that the theme, categories, suggested action,
  and response draft are proposals only. Confirm the customer text and rating
  have no edit controls.
- Enter a merchant reason and approve the review.
- Edit the merchant response if needed, enter a publication reason, and publish
  it separately. A failed or stale action must leave product edits and the prior
  public review state unchanged.

### 7. Publication and cross-surface discovery

- Publish only the approved disposable product.
- Open **View published product**, verify the stable `cat_...` ID, and confirm
  only the approved review and published merchant response are visible.
- Search for that ID or exact title in storefront chat.
- In the configured ChatGPT/App experience, use the existing product search and
  detail tools to find the same product. Confirm no draft, workflow event, or
  developer metadata appears in tool or widget payloads.
- Archive or retain the product according to the meeting plan.

## Recovery matrix

| Failure | Presenter action | What remains safe |
| --- | --- | --- |
| Responses unavailable | Retry once, then use the fallback product | Current draft and public catalog |
| Moderation blocks | Explain the policy stop and use a safe instruction | No product or image job is created |
| Image generation fails | Retry the same action or show the fallback product | Draft and approved published image |
| Image polling expires | Retry status; do not create a second job | Existing worker job and draft |
| Realtime fails | Stop voice and continue with text | Same workflow and draft |
| Review assistance fails | Continue with a manual merchant decision or retry | Customer text, product edits, and prior public state |
| Review decision is stale | Refresh reviews and repeat the decision against the current version | Customer text, product edits, and prior public state |
| Publication fails | Keep the draft private and retry after checking health | Last published product |
| ChatGPT discovery fails | Show the public PDP and preflight evidence | Published catalog record |

## Known-good fallback product

Before the session, select a stable, already-published product with complete
images, variants, and inventory. Store its `cat_...` ID in the deployment secret
`VITE_CATALOG_STUDIO_FALLBACK_PRODUCT_ID`. Verify it on the public PDP,
storefront chat, and ChatGPT. This is preconfigured data, not evidence that the
live APIs succeeded during the meeting; say so when using it.

Never reuse a private draft ID as the fallback. The value is exposed publicly in
`/config.json` for presenter recovery.

Use `scripts/seed_product_reviews.py` in the backend repository to attach the
synthetic review fixtures to the rehearsal product. Do not use live customer
reviews for the scripted moderation path.

## Coverage boundary

The frontend suite mocks authorization, supplier upload handoff, suggestion
review, grounded voice Q&A, field voice proposals, manual editing, media,
inventory, readiness, review decisions, publication handoff, and public review
rendering. It verifies that private source IDs and moderation fields are not
rendered publicly.

The deployed preflight is still required for Clerk authorization, OpenAI
Responses and Moderation, the image worker and object storage, Realtime WebRTC,
database migrations and seeded fixtures, publication, storefront reload, chat,
and ChatGPT/MCP discovery. Record those results separately; a mocked test is not
evidence that a provider or deployed worker succeeded.

## Evidence and observability

Datadog receives high-level `catalog_studio.milestone` actions for workflow
start, text/voice completion, image lifecycle, publication, and recoverable
errors. Context is allowlisted to operational status and stable IDs; prompts,
draft payloads, credentials, and provider responses are excluded.

The in-app **Dev Tools** trace tray captures selected user actions while
Developer tools are enabled and the authorized session advertises
`api_traces.configured`.
Catalog draft, supplier source, suggestion, media, lifecycle, Realtime voice, and
storefront chat turns register explicit UI root spans so live and replay demos
can correlate the action, HTTP calls, events, and sanitized artifacts without
turning every background refresh into a primary trace.

Capture these items in meeting notes:

- frontend and backend releases;
- preflight time and presenter account (email only);
- live product and fallback product IDs;
- capability readiness;
- storefront, chat, and ChatGPT discovery result;
- any recovery path used.

Do not claim publication or ChatGPT discovery as CI coverage. The frontend suite
mocks documented contracts; the final cross-repository handoff is a recorded
manual check.
