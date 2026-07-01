# Sterling Hollis Chat, OpenAI, and Observability Map

This is a presentation-oriented map of how the storefront chat request moves from the React UI, through the FastAPI backend capability registry, into OpenAI-backed routing and catalog tools, and out to Datadog/API trace observability. The labels on boxes use a short reference code so the diagrams can be discussed verbally in a slide deck.

Authoritative backend contract sources:

- `quickstarkdemo/sterling-hollis-be/docs/capability-map.md`
- `quickstarkdemo/sterling-hollis-be/docs/openapi.json`
- frontend manifest: `src/contracts/backendCapabilityManifest.json`

The frontend manifest is refreshed with `npm run refresh:api-contract` and keeps the OpenAPI `x-sterling-*` capability metadata used by the API client drift tests.

Storefront voice uses `GET /api/chat/realtime/capability`, `POST /api/chat/realtime/sessions`, and `POST /api/chat/realtime/tool-calls`. The browser only exposes compact lifecycle events plus bounded visible user and assistant transcript turns to the trace projection. It does not place raw audio, SDP offers or answers, provider payloads, or ephemeral Realtime credentials into the trace UI.

## Unified Capability Vocabulary

| Surface | Frontend entry point | Backend capability surface | Notes |
| --- | --- | --- | --- |
| Storefront chat | `src/components/ChatWidget.jsx` | `public_shopper` / `shopper.chat.turn` | Text and consumer voice turns share the shopper chat response renderer. Capability diagnostics are hidden unless diagnostics mode is enabled. |
| Catalog Studio assistant | `src/components/admin/CatalogGlobalAssistant.jsx` | `catalog_admin` | Text and read-only voice tools use current assistant/v3 capability routes. |
| Developer trace UI | `src/components/api-trace/*` | `developer_trace` | Trace inspector projects capability id, surface, and status from unified metadata. |
| Operator demo controls | `src/components/DemoObservabilityPanel.jsx` | `operator_compatibility` | Intentionally operator-scoped and not part of normal shopper/admin UI. |
| MCP / ChatGPT clients | backend-hosted MCP bundles | persona-scoped bundles | Public/shopper/catalog-admin/associate/executive bundles share the same registry with persona policy boundaries. Send-capable bundles require explicit approval policy. |

## Diagram 1: End-To-End Chat Request

```mermaid
flowchart LR
  FE1["1A. Page context<br/>src/pages/* + usePageChatContext"] --> FE2["1B. ChatContextProvider<br/>route, page_type, product, category, store_id"]
  FE2 --> FE3["1C. ChatWidget<br/>message, conversation_id, context"]
  FE4["1D. AuthTokenBridge<br/>Clerk bearer token when signed in"] --> FE5["1E. apiClient Axios interceptor"]
  FE3 --> FE5
  FE5 --> API["1F. POST /api/chat<br/>app/routers/chat.py"]

  API --> AUTH["1G. optional_chat_identity<br/>app/services/auth/clerk.py"]
  API --> DB1[("1H. Postgres session<br/>get_db()")]
  AUTH --> ORCH["1I. handle_chat<br/>app/services/chat/orchestrator.py"]
  DB1 --> ORCH

  ORCH --> PERSIST1[("1J. ChatSession + ChatTurn<br/>chat_sessions, chat_turns")]
  ORCH --> SAFETY["1K. Safety guard<br/>app/services/chat/safety.py"]
  SAFETY --> ROUTE["1L. Route and intent decision<br/>Strands candidate or ChatIntakeAgent"]
  ROUTE --> FRAME["1M. Intent frame<br/>normalized categories, genders, budget, product anchor"]
  FRAME --> EXEC["1N. Execute selected tool or StorefrontShoppingAgent"]

  EXEC --> DATA["1O. Catalog, customer, order, store data<br/>SQL + optional Pinecone"]
  EXEC --> OPENAI["1P. OpenAI components<br/>chat completion, Strands model, embeddings"]
  EXEC --> RESP["1Q. ChatResponse<br/>message, cards, actions, capability-aware tool_trace"]
  RESP --> PERSIST2[("1R. ChatMessage + ChatToolCall<br/>assistant response and tool outputs")]
  RESP --> FE3

  ORCH -. spans, tags, evals .-> DD["1S. Datadog LLMObs/APM"]
  FE3 -. RUM/logs/resource tracing .-> DDRUM["1T. Datadog Browser RUM + Logs"]
```

**What is happening:** the UI gathers page context before the user sends a message, then `ChatWidget` posts to `/api/chat`. The backend resolves optional Clerk identity, persists or resumes a chat session, creates an idempotent chat turn, evaluates safety, chooses the routing path through the shared capability model, executes one tool or agent path, persists the response and tool calls, and returns a `ChatResponse` containing the assistant message plus product cards/actions and capability-aware trace metadata. Datadog and API traces are wired on both sides: frontend RUM/logs in `src/utils/datadog.js`, frontend trace projection in `src/utils/apiTraceProjection.js`, and backend capability/LLMObs/APM spans in the backend services.

## Diagram 2: Backend Python Route Through A Chat Turn

```mermaid
flowchart TD
  A["2A. FastAPI router<br/>app/routers/chat.py: chat()"] --> B["2B. handle_chat()<br/>app/services/chat/orchestrator.py"]
  B --> C["2C. _normalize_context()<br/>hydrate current product from catalog when present"]
  C --> D["2D. _persist_session()<br/>bind session to anonymous or Clerk-linked identity"]
  D --> E{"2E. Duplicate request?"}
  E -- "client_request_id matched" --> ER["2F. Return stored ChatTurn response<br/>duplicate_replay=true"]
  E -- "new turn" --> F["2G. _create_chat_turn()<br/>status=pending"]

  F --> G["2H. LLMObs root agent<br/>sterling_hollis_chat"]
  G --> H["2I. _recent_history()<br/>last 8 messages"]
  H --> I["2J. evaluate_chat_safety()<br/>Datadog AI Guard or deterministic fallback"]
  I --> J{"2K. Safety intercepted?"}

  J -- "yes" --> K["2L. _safety_response()<br/>SafetyGuard / safety_refusal"]
  J -- "no" --> L{"2M. Strands product mode eligible?"}

  L -- "yes" --> M["2N. _strands_candidate_decision()<br/>public tools only"]
  M --> N["2O. build_chat_intent_frame()<br/>app/services/chat/intent_frame.py"]
  N --> O["2P. run_storefront_shopping_agent()<br/>app/services/chat/strands_orchestrator.py"]

  L -- "no" --> P["2Q. evaluate_chat()<br/>app/services/chat/evaluator.py"]
  P --> Q["2R. build_chat_intent_frame()<br/>normalize constraints"]
  Q --> R["2S. auth_gate<br/>block customer-only tools unless linked"]
  R --> S["2T. _execute_selected_tool_response()<br/>store_info, service_answer, order_status, product_detail, semantic search, etc."]

  O --> U["2U. Unified capability trace metadata<br/>capability id, operation, surface, side effect, persona"]
  S --> U
  K --> V["2V. Persist user + assistant messages<br/>complete ChatTurn and commit"]
  U --> V
  V --> W["2W. _submit_chat_evaluations()<br/>LLMObs score metrics"]
  W --> X["2X. Return ChatResponse to frontend"]
```

**What is happening:** `handle_chat()` is the central Python function for a chat turn. It wraps the whole turn in Datadog LLMObs, then runs a structured sequence: normalize request context, load history, safety-check the message, choose an orchestration path, run the selected capability/tool or agent, annotate the trace with unified capability metadata, persist the final state, and submit evaluation scores.

## Diagram 3: Routing And Tool Selection

```mermaid
flowchart LR
  M["3A. User message + ChatContext"] --> T["3B. triage_chat()<br/>deterministic retail keyword rules"]
  T --> S{"3C. chat_orchestration_mode<br/>== strands_product?"}

  S -- "eligible public request" --> SA["3D. StorefrontShoppingAgent path<br/>selected_tool=strands_agent"]
  SA --> ST["3E. Strands public tools<br/>search_catalog, semantic_catalog_search, get_current_product, get_product_detail, find_related_products, get_store_info"]

  S -- "deterministic mode or not eligible" --> CI["3F. ChatIntakeAgent<br/>evaluate_chat()"]
  CI --> OAI["3G. OpenAI structured output<br/>ChatEvaluation schema"]
  OAI --> LOW{"3H. confidence below threshold<br/>or OpenAI unavailable/error?"}
  LOW -- "yes" --> DF["3I. deterministic_fallback<br/>triage_chat result"]
  LOW -- "no" --> DEC["3J. selected_agent + selected_tool"]
  DF --> DEC

  DEC --> AUTH{"3K. Requires customer data?"}
  AUTH -- "not linked" --> BLOCK["3L. blocked response<br/>sign-in action"]
  AUTH -- "allowed" --> TOOL["3M. Execute selected tool"]

  TOOL --> PUB["3N. Public tools<br/>store_info, service_answer, product_detail, related_products, semantic_catalog_search"]
  TOOL --> PRIV["3O. Customer tools<br/>customer_summary, customer_recommendations, order_status"]
  TOOL --> GEN["3P. General response<br/>chat_response"]
```

**What is happening:** deterministic `triage_chat()` always provides a fallback interpretation. In deterministic mode, `evaluate_chat()` may call OpenAI to produce a structured `ChatEvaluation`; if there is no API key, low confidence, or an error, it falls back to deterministic triage. In `strands_product` mode, selected public product/store requests can bypass the intake LLM and run through `StorefrontShoppingAgent` with public tools only. Customer-specific tools always pass through the auth gate.

## Diagram 4: OpenAI And Catalog Retrieval Components

```mermaid
flowchart TD
  A["4A. ChatIntakeAgent<br/>app/services/chat/evaluator.py"] --> B["4B. OpenAI Chat Completions parse<br/>client.beta.chat.completions.parse"]
  B --> C["4C. ChatEvaluation<br/>intent, agent, tool, confidence, constraints"]

  D["4D. StorefrontShoppingAgent<br/>app/services/chat/strands_agent.py"] --> E["4E. Strands Agent + OpenAIModel<br/>model=settings.chat_orchestration_model"]
  E --> F["4F. Strands tool calls<br/>app/services/chat/strands_tools.py"]

  G["4G. semantic_catalog_cards()<br/>app/services/chat/tools.py"] --> H["4H. query variants<br/>normalized query + constraints"]
  H --> I["4I. EmbeddingService<br/>app/services/embeddings.py"]
  I --> J["4J. OpenAI embeddings<br/>text-embedding-3-small by default"]
  J --> K["4K. PineconeService.query()<br/>catalog vector namespace"]
  K --> L["4L. SQL hydration/filtering<br/>catalog_products, variants, store_inventory"]
  H --> M["4M. SQL text fallback<br/>when vector search disabled or empty"]
  M --> L

  F --> G
  C --> N["4N. selected tool execution"]
  N --> G
  L --> O["4O. CatalogProduct cards<br/>rendered by ChatWidget"]
```

**What is happening:** there are three main OpenAI-backed surfaces. First, the intake evaluator uses an OpenAI structured-output chat completion to choose the right agent/tool. Second, the optional Strands agent uses an OpenAI model to orchestrate public storefront tools. Third, semantic catalog search uses OpenAI embeddings, then Pinecone vector search, then SQL hydration and availability filtering. If embeddings or Pinecone are not configured, catalog search falls back to SQL text/category search.

## Diagram 5: Observability Wiring

```mermaid
flowchart TD
  FE["5A. Frontend initDatadog()<br/>src/utils/datadog.js"] --> RUM["5B. Browser RUM, Logs, Session Replay<br/>user actions + frontend errors"]
  RUM --> TRACEURL["5C. allowedTracingUrls<br/>API resource tracing when configured"]

  USER["5D. DatadogUserBridge<br/>Clerk user + auth context"] --> RUM
  DEMOUI["5E. DemoObservabilityPanel<br/>operator toggles latency/error mode"] --> ADMIN["5F. /admin/demo/observability<br/>app/routers/admin_synthetic.py"]
  ADMIN --> DEMOSTATE["5G. demo_observability.py state<br/>incident_id + correlation_key"]

  API["5H. /api/chat backend turn"] --> ROOT["5I. LLMObs.agent<br/>sterling_hollis_chat"]
  ROOT --> WF["5J. LLMObs.workflow<br/>chat_turn"]
  WF --> SAFETY["5K. LLMObs.tool<br/>chat_safety_guard"]
  WF --> INTAKE["5L. LLMObs.workflow/llm<br/>chat_intake + chat_intake_llm_call"]
  WF --> EXEC["5M. LLMObs.tool<br/>execute_selected_tool + selected_tool"]
  EXEC --> STRANDS["5N. LLMObs.agent<br/>StorefrontShoppingAgent when used"]
  EXEC --> ATP["5O. LLMObs.tool + APM span<br/>available_to_promise_reconciliation demo"]
  ATP --> DEMOSTATE
  WF --> PERSIST["5P. LLMObs.tool<br/>persist_user_message + persist_assistant_message"]
  ROOT --> EVAL["5Q. LLMObs evaluations<br/>route confidence, auth blocked, card count, semantic search, safety blocked"]

  API --> LOGS["5R. Datadog log correlation<br/>app/observability/logging.py"]
  API --> OTEL["5S. Strands OpenTelemetry export<br/>app/observability/llm_otel.py"]
```

**What is happening:** frontend Datadog captures browser-level user/session context, while the backend creates a nested LLMObs trace for each chat turn. The root span is `sterling_hollis_chat`; child spans identify safety, history, context normalization, intake routing, selected tool execution, persistence, and optional Strands agent activity. The demo observability harness injects a realistic latency/error span into the chat path with stable `incident_id` and `correlation_key` tags for presentation demos.

## Reference Key

| Ref | Component | Primary files |
| --- | --- | --- |
| 1A-1E | Frontend context, auth, and API client | `src/components/ChatContextProvider.jsx`, `src/components/ChatContext.jsx`, `src/components/ChatWidget.jsx`, `src/components/AuthTokenBridge.jsx`, `src/utils/apiClient.js` |
| 1F-2B | FastAPI chat entrypoint | `app/routers/chat.py`, `app/services/chat/orchestrator.py` |
| 1G | Optional Clerk identity | `app/services/auth/clerk.py` |
| 2C-2G | Session, idempotency, and persistence setup | `app/services/chat/orchestrator.py`, `app/models.py` |
| 2J-2L | Safety handling | `app/services/chat/safety.py`, `app/services/chat/orchestrator.py` |
| 3A-3P | Routing, auth gate, and tool choice | `app/services/chat/triage.py`, `app/services/chat/evaluator.py`, `app/services/chat/intent_frame.py`, `app/services/chat/orchestrator.py` |
| 4A-4C | OpenAI structured route evaluator | `app/services/chat/evaluator.py`, `app/services/chat/agents.py` |
| 4D-4F | Strands storefront agent | `app/services/chat/strands_agent.py`, `app/services/chat/strands_orchestrator.py`, `app/services/chat/strands_tools.py` |
| 4G-4O | Catalog, embeddings, Pinecone, SQL fallback | `app/services/chat/tools.py`, `app/services/embeddings.py`, `app/services/pinecone_service.py`, `app/catalog/service.py` |
| 5A-5D | Frontend Datadog | `src/utils/datadog.js`, `src/components/DatadogUserBridge.jsx` |
| 5H-5Q | Backend LLMObs spans and evaluations | `app/services/chat/orchestrator.py`, `app/services/chat/evaluator.py`, `app/services/chat/strands_orchestrator.py`, `app/services/chat/tools.py` |
| 5E-5G, 5O | Demo observability harness | `src/components/DemoObservabilityPanel.jsx`, `app/routers/admin_synthetic.py`, `app/services/demo_observability.py` |
| 5R-5S | Backend log/OTel export setup | `app/observability/logging.py`, `app/observability/llm_otel.py`, `app/observability/genai_otel.py` |

## Slide Narrative

1. The frontend owns shopper context. Each page registers the current route, store, category, and product context. The chat drawer sends that context plus the user message to `/api/chat`.
2. The backend owns trust and persistence. It resolves Clerk identity if a bearer token is present, creates or reuses a chat session, detects duplicate/retry turns, and persists every user and assistant message.
3. The backend evaluates safety before routing. Datadog AI Guard is used when configured; otherwise the code can use a deterministic demo fallback or allow the request depending on environment.
4. Routing has a fallback-first design. Deterministic `triage_chat()` always provides a usable decision. OpenAI structured output improves routing when configured, but low confidence or failures fall back to deterministic routing.
5. Product discovery has layered retrieval. Semantic search tries OpenAI embeddings plus Pinecone first, then falls back to SQL text/category browsing, and finally hydrates product cards from the database with store availability filters.
6. Observability is built into the path rather than added outside it. Each meaningful stage has LLMObs span metadata, tool inputs/outputs are annotated, final evaluations are submitted, and the demo harness can inject a tagged latency/error scenario for Datadog presentations.

## Practical Presentation Notes

- Use Diagram 1 as the executive overview.
- Use Diagram 2 when explaining the Python code path.
- Use Diagram 3 when discussing why a chat request becomes a specific tool call.
- Use Diagram 4 when the audience asks where OpenAI is actually used.
- Use Diagram 5 when the focus is Datadog, LLMObs, trace tags, and the demo fault harness.
