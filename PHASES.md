# Build Plan

## Phase 1 (Complete)

- MV3 extension skeleton with popup/options.
- Main-world bridge interception for `fetch`, `XHR`, and `WebSocket.send`.
- Background orchestration and volatile session vault.
- Deterministic PII detector + format-preserving fake generation.
- Payload-aware transformation for common chat payload shapes.
- DOM rehydration of assistant responses.
- Unit tests for detection and transformation correctness.

## Phase 2 (Active, advanced core delivered)

- [x] Site adapters for ChatGPT, Claude, Gemini + generic fallback.
- [x] Adapter-driven transform orchestration in background.
- [x] Stream-aware DOM rehydration across token-split text nodes.
- [x] Adapter contract tests with replay fixtures.
- [x] Edge-case adapter handling: multimodal parts, tool-use blocks, nested Gemini payloads.
- [x] Expanded replay fixture corpus for provider variants.
- [x] Provider-specific streaming replay fixtures and long-response stress tests.
- [x] Options debug panel with runtime adapter/replacement trace events.
- [x] HAR import workflow for sanitizing captures into fixture files.
- [ ] Request/response corpus generated from live captures and continuously updated.

## Phase 3 (In progress)

- [x] Local NER/PII model integration with on-device fallback chain.
- [x] Entity confidence fusion controls (confidence scoring + minimum threshold gate).
- [x] International PII pattern packs and custom dictionaries (IBAN + configurable term dictionary).

## Phase 4 (Core complete)

- [x] Canary telemetry (no PII) with per-adapter aggregates and latency quantiles.
- [x] Release automation, compatibility matrix, and regression harness.
- [x] Perf hardening and memory pressure handling (payload caps + session memory pruning).
