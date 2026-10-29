# LLM catalog review — 28 October 2026

This review implements [issue #3](https://github.com/BruceKhetta/logicle/issues/3)
against the stock catalog in `packages/core/src/models/`. The issue says 11
models/presets, but enumerates **10**. Its referenced `models.md` is not in this
checkout; the explicit issue table is the implementation baseline.

## Catalog and integration decisions

Eight new IDs are offered directly and through Logicle Cloud. The provider API
identifier equals the platform ID for each new model. The Cloud proxy must
support the corresponding API and have the model enabled; local catalog entries
cannot establish remote availability.

| Platform/API ID     | Direct provider                  |           Context | Output cap in Logicle | Reasoning choices                        |
| ------------------- | -------------------------------- | ----------------: | --------------------: | ---------------------------------------- |
| `gpt-6.1-sol`       | OpenAI Responses                 |         1,050,000 |               128,000 | low, medium (default), high, xhigh       |
| `gpt-6.1-terra`     | OpenAI Responses                 |         1,050,000 |               128,000 | none, low, medium (default), high, xhigh |
| `gpt-6-luna`        | OpenAI Responses                 |         1,050,000 |               128,000 | none, low, medium (default), high, xhigh |
| `claude-opus-5-5`   | Anthropic Messages               |         1,000,000 |               128,000 | low, medium (default), high              |
| `claude-sonnet-5-5` | Anthropic Messages               |         1,000,000 |               128,000 | low, medium, high (default)              |
| `claude-haiku-5-5`  | Anthropic Messages               |         1,000,000 |               128,000 | low, medium (default), high              |
| `gemini-4-argon`    | Google AI Studio GenerateContent | 1,048,576 unified |       65,536 streamed | low, medium (default), high              |
| `gemini-3.8-flash`  | Google AI Studio GenerateContent |   1,048,576 input |                65,536 | low, medium (default), high              |

OpenAI's documented `max` effort and Anthropic's additional effort levels are
not exposed in this change: the application's existing reasoning enum remains
unchanged. Sampling controls are suppressed for the new reasoning models.
OpenAI uses the existing `o200k_base` estimator; Anthropic and Gemini use the
existing heuristic estimators. These estimate budgeting costs, not exact
provider token counts (Haiku 5.5 uses a newer provider tokenizer).

All eight advertise text, image, and PDF input plus automatic function calling.
Audio/video and provider-native search are deliberately not newly advertised:
provider support alone does not validate those paths in this application.
Anthropic's PDF cap remains a conservative 100 pages. The model DTO now preserves
that cap and the temperature capability when serializing model responses.

- OpenAI tool calling requires Responses. That path already exists for direct
  OpenAI and Cloud (`openai/<model>`). SDK `@ai-sdk/openai@3.0.0` does not recognize
  GPT-6 as reasoning automatically, so GPT-6 requests explicitly set
  `forceReasoning: true`. Stateless calls retain encrypted reasoning data.
- Claude 5.5 uses adaptive thinking and effort, not the old fixed thinking token
  budgets. Summarized thinking is requested for visible progress. Forced tool
  selection is rejected locally with an actionable error; automatic tool calling
  remains supported. Keep thinking blocks/signatures unchanged and use a new
  conversation when changing model or provider account.
- Gemini 4 uses `thinkingLevel`, not `thinkingBudget`; both new Gemini entries
  expose only low/medium/high. Argon's unified window must contain input,
  thinking, tools, and output. Logicle uses the synchronous streaming cap, not
  the million-token continuation/background feature. An application-wide output
  cap can reduce any catalog limit further.

Specifications: [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol),
[Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra),
[Luna](https://developers.openai.com/api/docs/models/gpt-6-luna),
[Opus](https://platform.claude.com/docs/en/models/opus-5-5/overview),
[Sonnet](https://platform.claude.com/docs/en/models/sonnet-5-5/overview),
[Haiku](https://platform.claude.com/docs/en/models/haiku-5-5/overview),
[Argon](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon),
[Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash).

## Explicit exclusions

| Proposed entry/path                     | Decision and reason                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `perplexity/preset/pro-search`          | Excluded: these are LiteLLM Responses identifiers, not Sonar Chat Completions model IDs. The direct Perplexity SDK and Cloud Perplexity path currently use Chat Completions.                                                                                                                                                                             |
| `perplexity/preset/deep-research`       | Same exclusion. Preserve `sonar-pro` and `sonar-deep-research` as explicit interim choices; neither is silently redirected to an Agent preset.                                                                                                                                                                                                           |
| Both new Gemini models on direct Vertex | Excluded: the adapter fixes location to `us-central1`. Flash documents `global`, `us`, and `eu`; Argon also documents selected regional endpoints, but neither lists `us-central1`. Changing region may change processing constraints and requires an explicit environment decision. AI Studio availability does not imply Vertex regional availability. |

[LiteLLM's Perplexity documentation](https://docs.litellm.ai/docs/providers/perplexity)
documents preset routing through Responses and requires version 1.72.6 or later.
No deployed LiteLLM version/configuration exists in this repository, so its
compatibility cannot be verified locally. The current
[Perplexity preset documentation](https://docs.perplexity.ai/docs/agent-api/presets)
redirects to an effort guide; do not infer current direct API preset semantics
from a LiteLLM alias. Supporting these two presets requires an explicitly tested
Agent/Responses adapter and verification of the target proxy, rather than adding
strings to the current Chat Completions catalog.

Regional references: [Argon on Google Cloud](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/4-argon),
[Flash on Google Cloud](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash).

## Previous catalog and migration

No existing `(provider, platform ID, routed model)` tuple is removed or retargeted.
The compatibility fixture `__tests__/fixtures/model-routes-before-issue-3.json`
records the complete pre-change stock catalog and tests preserve every tuple.
The stock OpenAI and Anthropic lists were larger than the study's examples;
Cloud also omitted several direct-provider entries. Cloud now derives its catalog
from the same provider definitions to prevent drift.

Older entries are retained as `obsolete` and grouped after current models in the
picker. Here **obsolete is a catalog simplification**, not a blanket statement
of provider retirement. Existing assistants keep their saved ID. There is no DB
migration or automatic replacement. Known API shutdowns in `models/lifecycle.ts`
produce a user-visible error before any provider call, with an explicit replacement
suggestion. Future shutdown dates do not block requests early. Unknown shutdowns
remain subject to provider errors; the local table is not a complete provider
availability oracle. Provisioned catalogs still override stock catalogs, while
the known-shutdown check applies to the actual routed provider/model.

| Previous IDs/family                                                                     | Explicit migration suggestion                                        | Status verified on 28 October                                                                           |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`                                                | `gpt-6-luna`                                                         | API deprecation announced; shutdown 14 January 2027, not already retired                                |
| `gpt-5`, `gpt-5-mini` (also nano)                                                       | Sol / Terra / Luna according to task                                 | API shutdown 11 December 2026                                                                           |
| `gpt-5.1`                                                                               | `gpt-6.1-sol`                                                        | API shutdown 1 April 2027                                                                               |
| `gpt-5.2`, `gpt-5.4`, `gpt-5.5`, `gpt-5.6-terra`, other older entries                   | Evaluate Sol / Terra / Luna explicitly                               | Catalog simplification; no retirement inferred                                                          |
| Legacy GPT chat variants and GPT-3.5/4/Turbo/nano entries covered by the shutdown table | Explicit current OpenAI ID                                           | Confirmed past API shutdowns; actionable local error                                                    |
| Claude 3/3.5/3.7, Opus/Sonnet 4 and Opus 4.1                                            | Corresponding Claude 5.5 tier                                        | Anthropic lists confirmed retirements for these generations; table blocks known exact routed IDs        |
| Claude 4.5, 4.6 and Sonnet 5                                                            | Corresponding Claude 5.5 tier                                        | Catalog simplification; retained references, not assumed retired                                        |
| `claude-sonnet-latest`                                                                  | `claude-sonnet-5-5`                                                  | Local legacy alias remains pinned to `claude-sonnet-5` and is labelled accordingly                      |
| `gemini-pro-latest`, `gemini-3.0-pro`, `gemini-3.1-pro`                                 | Argon on AI Studio, after explicit review                            | Local routes remain `gemini-3.1-pro-preview`; names now say 3.1 Pro Preview                             |
| `gemini-1.5-*`, `gemini-2.0-*`                                                          | Review the actual existing 2.5 target before selecting a replacement | These local IDs already route to 2.5. Labels/alias limits are corrected without changing those routes   |
| `gemini-2.5-pro`, `gemini-2.5-flash`                                                    | Argon / Flash on AI Studio                                           | Gemini API documents continued restricted legacy access and no shutdown date; do not call these retired |
| Gemini 3.5/3.6/3.7 Flash and latest Flash alias                                         | `gemini-3.8-flash` on AI Studio                                      | Simplified locally; Gemini API documents provider-side redirection for 3.5/3.7, not endpoint shutdown   |
| Sonar variants and `sonar-latest`                                                       | Keep an explicit Sonar selection until Agent adapter validation      | Catalog simplification; no Sonar retirement asserted                                                    |

Lifecycle references: [OpenAI API deprecations](https://developers.openai.com/api/docs/deprecations),
[Anthropic model deprecations](https://docs.anthropic.com/en/docs/about-claude/model-deprecations),
[Gemini API deprecations](https://ai.google.dev/gemini-api/docs/deprecations).
Dates and platform-specific policies should be rechecked before a later release.

## Validation boundary

Local tests use the installed SDKs with simulated HTTP JSON/SSE responses, inspect
serialized requests, and check text/tool-call normalization, image/PDF transport,
reasoning options, retired-model rejection, DTO preservation, and legacy routing.
They establish application/SDK compatibility; they do not prove credentials,
account access, proxy model aliases, real multimodal comprehension, latency, or
regional data-processing compliance. No paid provider calls or infrastructure
changes are part of this review. Deployment-specific live validation remains
outstanding and the issue should not claim that it has occurred.

Validation performed locally:

- `npm run check-types` — passed.
- `npm test -- __tests__/modelCatalog.test.ts __tests__/modelCatalogIntegration.test.ts __tests__/providerFactory.test.ts __tests__/parallelToolCalls.test.ts __tests__/convertToLitellmChatMessages.test.ts __tests__/conversion.test.ts __tests__/providersMock.test.ts` — 85 tests passed in seven files.
- `DATABASE_URL=memory: FILE_STORAGE_LOCATION=. APP_URL=http://localhost:3000 node --import=tsx apps/backend/generate_openapi.ts --out apps/frontend/public/openapi.yaml` — generated successfully. The npm wrapper's tsx IPC socket was blocked by the sandbox, so the same generator ran directly with the tsx loader.
- `git diff --check` — passed.

The installed local runtime was Node 25.6.0, while the repository targets Node 24;
execution on Node 24 remains unverified. Existing dependencies were installed
from the frozen lockfile and SQLite's native binding was rebuilt locally;
no dependency declarations or lockfile were changed.
