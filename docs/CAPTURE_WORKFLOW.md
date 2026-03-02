# Capture Workflow

Use this workflow to refresh fixtures from real provider traffic while avoiding storage of sensitive values.

## 1. Export HAR

1. Open browser DevTools on the provider site.
2. Go to Network, enable "Preserve log".
3. Run one chat exchange.
4. Export as HAR.

## 2. Import and sanitize

From the project root:

```bash
npm run corpus:import -- --har /absolute/path/to/session.har --name chatgpt-live-001 --provider chatgpt --kind request
```

Response example:

```bash
npm run corpus:import -- --har /absolute/path/to/session.har --name claude-live-001 --provider claude --kind response
```

Notes:

- `--provider auto` uses adapter detection from URL/body.
- `--index` selects a specific candidate request when HAR contains multiple entries.
- Output defaults to `tests/fixtures/captured/<name>.<kind>.json`.

## 3. Convert into test fixtures

- Move useful `body` payloads into `tests/fixtures/` or `tests/fixtures/responses/`.
- Add/extend adapter and replay tests to cover new payload shapes.
- Keep fixture descriptions short and specific to the edge case.

## 4. Verify

```bash
npm test
```

The importer sanitizes detected PII in all string fields before writing fixture files.
