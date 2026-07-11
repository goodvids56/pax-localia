# Local AI contracts

## Authority model

A local model narrates, interprets, and proposes. It is never authoritative over
world state. It receives no filesystem, process, database, network, MCP, plugin,
or simulation tool. The only state-changing path is:

1. complete response body;
2. JSON parse;
3. optional removal of one obvious Markdown code fence;
4. Zod contract validation;
5. one constrained repair request when parsing/schema validation fails;
6. reference/date/rule validation against the unchanged snapshot;
7. deterministic effect application to a clone;
8. one SQLite transaction.

Partial streamed JSON is never applied. Casual diplomacy cannot transfer
territory or end a war; it can create a pending structured commitment.

## Provider interface

`packages/ai/src/types.ts` defines a common interface for:

- capabilities;
- model discovery;
- health checks;
- generic structured generation;
- streamed chat;
- measured suitability probe;
- optional explicit model load/unload.

Provider errors use stable codes for blocked endpoints, unavailable servers,
authentication, malformed responses, missing/unloaded models, load failure,
context overflow, schema failure, disconnect, timeout, cancellation, and HTTP
errors. Every code has actionable local help text.

## LM Studio

LM Studio is a separate adapter, not a renamed generic provider.

Discovery first probes `GET /api/v1/models`. Reported model metadata is mapped
without inferring quality from a filename:

- stable key and display name;
- publisher and architecture;
- GGUF/MLX/other format;
- quantization, parameter label, and size;
- loaded state and exact instance ID;
- loaded context and architectural maximum;
- reported load configuration;
- reported vision, tool-training, and reasoning capabilities.

Explicit embedding models are excluded from chat selectors. If the native API
returns 404/405 or a malformed unsupported shape, the adapter falls back to
`GET /v1/models` and marks native lifecycle/token features unavailable.

Explicit lifecycle calls use:

- `POST /api/v1/models/load`
- `POST /api/v1/models/unload`

Load options are omitted when set to Automatic so LM Studio keeps its own
defaults. Pax Localia never downloads a model, invokes `lms`, starts LM Studio,
or unloads a model automatically.

State-changing output uses `POST /v1/chat/completions` with:

```json
{
  "stream": false,
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "pax_localia_turn_proposal",
      "strict": true,
      "schema": {}
    }
  }
}
```

The JSON Schema is generated from the same Zod contract that validates the
returned value. Ordinary dialogue uses streamed OpenAI-compatible completions.
`reasoning_content` is converted to a generic progress phase and never shown or
stored. Only final content deltas enter a message.

The compatibility probe performs one tiny strict structured request and one
short stream. Suitability is mechanical:

- Simulation requires validated structured output.
- Diplomacy and Advisor require a completed text stream.
- Summarization requires either structured or streamed output.

This is not a claim about model intelligence or factual quality. Probe cache
keys include provider, sanitized endpoint, model key, and context metadata and
expire after 30 minutes.

## Ollama and generic compatible servers

Ollama uses `/api/tags` and `/api/chat`, requests a JSON Schema through the
`format` field, and parses newline-delimited streams. Evaluation counts and
duration are used only when Ollama reports them.

The generic adapter uses `/v1/models` and `/v1/chat/completions`. It provides no
native lifecycle claim.

All adapters use `AbortSignal`, an explicit timeout, response-body teardown, and
at most one configured network retry. Schema repair is separate and happens at
most once.

## Deterministic fallback

The deterministic provider advertises no LLM structured-output or streaming
capability. World proposals come directly from `packages/simulation`, using the
saved seed/counter, actor capability, effort, priority, difficulty resistance,
and bounded uncertainty. Its diplomacy/advisor text explicitly identifies
itself as a deterministic assessment.

This is the CI provider and complete no-model gameplay path.

## Turn proposal

`TurnProposalSchema` includes:

- bounded summary;
- per-action interpretation, feasibility, outcome, explanation, and effects;
- bounded autonomous developments;
- dated structured events;
- bounded follow-up suggestions.

Every actor, action, and region reference is checked against the current
snapshot. Events must fall inside the jump. Unknown references reject the
proposal before any effect is applied.

Individual `WorldEffect` commands validate active actors, current
owner/controller, features, bounds, adjacency, conflict/claim/treaty basis,
resource non-negativity, and successor requirements. Accepted and rejected
effects both remain in the turn audit record.

## Context assembly

`assembleTurnContext` selects:

- trusted scenario premise, directives, safety constraints, and feature flags;
- current date, player actor, involved actors and regions;
- active treaties, conflicts, and unresolved commitments;
- submitted actions;
- relevant recent conversation messages;
- severe or directly relevant events.

Directly involved regions add adjacent regions. Active conflicts and
commitments add their participants. Each section has an explicit character
budget; the total uses a conservative 3.2 characters/token estimate when a
provider tokenizer is unavailable. Output tokens and a safety margin are
reserved before the request.

Context hashes record canonical content without logging the content itself.

## Prompt-injection boundary

System rules label scenario directives as constrained game data and player/
community text as untrusted in-world data. Prompts explicitly state that such
text cannot request:

- files or local paths;
- shell/process execution;
- database access;
- network access;
- credentials or diagnostics;
- tools/plugins/MCP;
- changes to application policy.

Imported instructions cannot add fields outside the scenario schema. Even a
successful prompt injection can only produce text or a proposal that still must
pass the same Zod and deterministic rules.

## Logging and diagnostics

Default AI request records may contain provider/model, purpose, prompt hash,
character counts, timing, status, and error code. Prompt content retention
defaults off.

Sanitized diagnostics omit or recursively redact token, authorization, secret,
password, prompt, chat, action, and raw response fields. They sanitize endpoint
queries/credentials and include this explicit promise:

> No prompts, chat text, actions, tokens, headers, or raw responses included.

The provider test fixtures cover native/fallback model discovery, loaded and
unloaded GGUF/MLX models, embedding exclusion, authentication, schema success
and repair failure, Markdown fences, streamed reasoning separation,
disconnect/abort/timeout, load failure, shorter loaded context, endpoint policy,
and diagnostics redaction.
