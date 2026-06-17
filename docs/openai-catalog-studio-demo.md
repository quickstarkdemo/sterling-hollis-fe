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
3. Describe one product outcome and create the draft.
4. Explain the business timeline: Responses structures the product, Moderation
   enforces policy, and the draft remains private.
5. Generate and approve an image, then publish explicitly.
6. Open the published product and find its stable catalog ID through ChatGPT.

Keep the developer lens off. Emphasize human approval, one catalog record, and
safe recovery rather than implementation details.

### Codex build path (10 minutes)

Use the executive path, then connect the shipped behavior to the repository
history: one GitHub issue and independently reviewable PR per plan unit, backend
contracts before consumers, and tests for authorization, moderation, recovery,
redaction, and publication. Do not imply that Codex bypassed code review or that
mocked tests validated live provider credentials.

### Developer-lens path (15 minutes)

Turn on **Developer lens** after the first successful draft. Walk through the
bounded event projection: capability, status, model, request ID, duration,
usage, and safe request/response summaries. State explicitly that credentials,
system instructions, private reasoning, raw audio, and unbounded provider
payloads are not sent to the browser and cannot be copied from this view.

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
- Open the Studio and confirm **Authorized**.
- Confirm Responses, Moderation, Image generation, Realtime voice, Worker
  storage, and Catalog all show **Ready**. Treat any unavailable capability as a
  live-system failure even if CI is green.

### 3. Text, moderation, and recovery

- Create a disposable test product with text and verify separate Responses,
  Moderation, and Catalog events.
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
- Speak one bounded refinement and confirm it updates the same workflow and draft.
- Stop voice and confirm the draft remains editable with text.
- If Realtime fails, continue with text; do not spend meeting time debugging the
  microphone, SDP exchange, or ephemeral token.

### 6. Publication and cross-surface discovery

- Publish only the approved disposable product.
- Open **View published product** and verify the stable `cat_...` ID.
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

## Evidence and observability

Datadog receives high-level `catalog_studio.milestone` actions for workflow
start, text/voice completion, image lifecycle, publication, and recoverable
errors. Context is allowlisted to operational status and stable IDs; prompts,
draft payloads, credentials, and provider responses are excluded.

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
