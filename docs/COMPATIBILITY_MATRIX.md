# Compatibility Matrix

Generated: 2026-02-27T21:13:59.709Z

## Request Adapter Coverage

| Provider | Fixture | Adapter | Changed | Replacements | Pass |
| --- | --- | --- | --- | ---: | --- |
| ChatGPT | chatgpt.request.json | chatgpt | Yes | 3 | Yes |
| ChatGPT | chatgpt.multimodal.request.json | chatgpt | Yes | 2 | Yes |
| Claude | claude.request.json | claude | Yes | 2 | Yes |
| Claude | claude.tooluse.request.json | claude | Yes | 1 | Yes |
| Gemini | gemini.request.json | gemini | Yes | 2 | Yes |
| Gemini | gemini.nested.request.json | gemini | Yes | 2 | Yes |
| Generic | generic.request.json | generic | Yes | 2 | Yes |
| Generic | generic.toolcall.request.json | generic | Yes | 1 | Yes |

## Response Rehydration Coverage

| Fixture | Segments | Replacements | Pass |
| --- | ---: | ---: | --- |
| chatgpt.stream.segmented.json | 4 | 1 | Yes |
| claude-long-stream.json | 6 | 4 | Yes |
| multi-token-overlap.json | 1 | 3 | Yes |
