# Release Workflow

This workflow builds a deterministic extension artifact with compatibility checks and checksums.

## 1. Run preflight

```bash
npm run preflight
```

Preflight runs:

- unit/integration tests,
- syntax checks across runtime/scripts/tests,
- compatibility matrix replay checks,
- manifest sanity validation.

## 2. Build release artifact

```bash
npm run release:build
```

Outputs in `dist/`:

- `veilguard-extension-v<version>.zip`
- `release-manifest.json` (artifact hash + per-file hashes)

`release:build` also refreshes [`docs/COMPATIBILITY_MATRIX.md`](COMPATIBILITY_MATRIX.md).

## 3. Quick local build (skip preflight)

```bash
npm run release:build:quick
```

Use only when preflight has already passed in the same workspace state.

## 4. Load artifact for verification

1. Unzip into a clean folder.
2. Open `chrome://extensions`.
3. Enable Developer Mode.
4. Load unpacked folder and run smoke checks on ChatGPT/Claude/Gemini.
