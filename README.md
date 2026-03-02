# VeilGuard — AI Privacy Shield

> A Chrome extension that automatically detects and redacts sensitive information (names, emails, API keys, addresses, etc.) before your prompts reach AI chatbots like ChatGPT, Claude, and Gemini — powered by a local AI model running on your machine.

**Your data never leaves your device.** VeilGuard uses [Ollama](https://ollama.com) to run a small language model locally that identifies and masks PII in real-time.

---

## 📸 Screenshots

<p align="center">
  <img src="screenshots/popup-disabled.png" alt="VeilGuard popup — disabled" width="320" />
  &nbsp;&nbsp;
  <img src="screenshots/popup-active.png" alt="VeilGuard popup — active" width="320" />
</p>
<p align="center"><em>Left: Extension disabled &nbsp;|&nbsp; Right: Protection active with live stats</em></p>

<p align="center">
  <img src="screenshots/chatgpt-redaction.png" alt="ChatGPT redaction proof" width="800" />
</p>
<p align="center"><em>ChatGPT — network payload shows PII replaced with PERSON and ORG placeholders</em></p>

<p align="center">
  <img src="screenshots/claude-redaction.png" alt="Claude redaction proof" width="800" />
</p>
<p align="center"><em>Claude — same redaction: real names and companies never reach the server</em></p>

<p align="center">
  <img src="screenshots/advanced-options.png" alt="VeilGuard settings and diagnostics" width="800" />
</p>
<p align="center"><em>Advanced settings — LLM config, operational metrics, event log, and runtime limits</em></p>

<p align="center">
  <img src="screenshots/memory-usage.png" alt="Low memory usage" width="800" />
</p>
<p align="center"><em>Ollama uses only ~50 MB RAM — lightweight enough to run in the background all day</em></p>

---

## ✨ Features

- **Real-time PII redaction** — Names, emails, phone numbers, API keys, passwords, addresses, IBANs, SSNs, and more are detected and replaced with safe placeholders before being sent.
- **Automatic rehydration** — AI responses containing placeholders are seamlessly restored to original values in the browser so you see the real content.
- **Multi-platform support** — Works with ChatGPT, Claude, Gemini, and any AI chat service.
- **100% local processing** — Powered by Ollama running on your machine. No cloud APIs, no data collection.
- **Lightweight model** — Uses `qwen2.5:1.5b` (~1GB) by default for fast, low-memory redaction.
- **One-click toggle** — Enable/disable protection instantly from the popup.
- **Model management** — Choose from any Ollama model via the dropdown, with automatic RAM cleanup on disable.
- **Setup guide** — Built-in platform-specific setup instructions for macOS, Windows, and Linux.
- **Advanced settings** — Custom sensitive terms, confidence thresholds, timeout controls, and reset-to-defaults.

---

## 🚀 Quick Start (Users)

### 1. Install Ollama

Download from [ollama.com/download](https://ollama.com/download) or use your package manager:

```bash
# macOS (Homebrew)
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Configure Ollama for VeilGuard

VeilGuard needs Ollama to allow browser extension requests. This is a **one-time setup**:

**macOS (Homebrew):**
```bash
echo 'export OLLAMA_ORIGINS="*"' >> ~/.zshrc && source ~/.zshrc
launchctl setenv OLLAMA_ORIGINS "*"
brew services start ollama
```

**macOS (.dmg app):**
```bash
launchctl setenv OLLAMA_ORIGINS "*"
```
Then open Ollama → Preferences → enable "Launch at login" and restart the app.

**Windows:**
Add `OLLAMA_ORIGINS` with value `*` as a System Environment Variable (Start → search "Environment Variables" → System variables → New). Restart Ollama.

**Linux (systemd):**
```bash
sudo systemctl edit ollama
# Add these lines:
# [Service]
# Environment="OLLAMA_ORIGINS=*"
sudo systemctl restart ollama && sudo systemctl enable ollama
```

### 3. Pull the AI Model

```bash
ollama pull qwen2.5:1.5b
```

### 4. Load the Extension

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer Mode** (top right).
3. Click **"Load unpacked"**.
4. Select the `veilguard-extension` folder.

### 5. Enable Protection

1. Click the VeilGuard icon in the toolbar.
2. Toggle **Privacy Protection** → ON.
3. Start chatting — sensitive data is automatically redacted!

> 💡 The extension includes a built-in **Setup Guide** page with detailed platform-specific instructions and live status checks. Access it when Ollama is not detected or via the popup.

---

## 🔧 How It Works

```
You type: "Hi, my name is John and my email is john@acme.com"
     ↓
VeilGuard intercepts the request before it leaves your browser
     ↓
Local Ollama model identifies PII: John → PERSON_1, john@acme.com → EMAIL_1
     ↓
Redacted text is sent to the AI: "Hi, my name is PERSON_1 and my email is EMAIL_1"
     ↓
AI responds using placeholders
     ↓
VeilGuard rehydrates the response: PERSON_1 → John, EMAIL_1 → john@acme.com
     ↓
You see the original names in the AI's response
```

### Architecture

1. **Page bridge** (`page/bridge.js`) — Intercepts `fetch` and `XHR` requests in the page context.
2. **Content script** (`content/content-script.js`) — Relays payloads between page and service worker, handles DOM rehydration.
3. **Service worker** (`background/service-worker.js`) — Core transform engine, session mapping store, Ollama lifecycle management.
4. **Adapters** (`background/adapters/`) — Platform-specific payload parsers for ChatGPT, Claude, Gemini, and generic APIs.
5. **Local LLM redactor** (`background/local-llm-redactor.js`) — Communicates directly with Ollama's `/api/chat` endpoint.

---

## 🛠️ Developer Guide

### Project Structure

```
veilguard-extension/
├── manifest.json              # Extension manifest (MV3)
├── background/
│   ├── service-worker.js      # Core logic, message handlers, Ollama lifecycle
│   ├── transform-engine.js    # Request transformation pipeline
│   ├── local-llm-redactor.js  # Ollama API integration
│   ├── session-store.js       # Per-tab/origin session mapping vault
│   ├── metrics.js             # Telemetry counters (no PII)
│   └── adapters/              # Platform-specific parsers
│       ├── chatgpt-adapter.js
│       ├── claude-adapter.js
│       ├── gemini-adapter.js
│       ├── generic-adapter.js
│       ├── index.js
│       └── utils.js
├── content/
│   └── content-script.js      # Bridge relay + DOM rehydration
├── page/
│   └── bridge.js              # Main-world fetch/XHR/WS interceptor
├── popup/                     # Extension popup UI
├── options/                   # Settings page
├── setup/                     # Setup guide page
├── shared/                    # Shared utilities (PII detection, NER, etc.)
├── tests/                     # Unit & contract tests
├── scripts/                   # Build, release, and dev tooling
└── docs/                      # Workflow documentation
```

### Running Tests

```bash
npm install
npm test
```

### Pre-release Checks

```bash
npm run preflight          # Syntax check + test suite
npm run check:syntax       # Syntax-only validation
```

### Building a Release

```bash
npm run release:build             # Full preflight + zip
npm run release:build:quick       # Skip preflight, just zip
```

Generates `dist/veilguard-extension-v<version>.zip` with a `release-manifest.json` containing file checksums.

### Compatibility Matrix

```bash
npm run compat:matrix             # Print to stdout
npm run compat:matrix:write       # Write to docs/COMPATIBILITY_MATRIX.md
```

### Key Configuration (service-worker.js)

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `false` | Protection starts disabled |
| `failPolicy` | `block` | Block or pass requests on redaction failure |
| `localLlmEndpoint` | `http://127.0.0.1:11434/api/chat` | Ollama API endpoint |
| `localLlmModel` | `qwen2.5:1.5b` | Model for redaction |
| `localLlmTimeoutMs` | `15000` | Request timeout |
| `minEntityConfidence` | `0.7` | PII detection threshold |
| `maxPayloadChars` | `1,000,000` | Skip payloads larger than this |

### Adding a New Adapter

1. Create `background/adapters/your-adapter.js`
2. Export `{ id, matches(url, payload), extractConversationId(payload), transformPayload(payload, ctx) }`
3. Register in `background/adapters/index.js`
4. Add test fixtures in `tests/fixtures/`

---

## 📋 Docs

- [Compatibility Matrix](docs/COMPATIBILITY_MATRIX.md)
- [Release Workflow](docs/RELEASE_WORKFLOW.md)
- [Capture Workflow](docs/CAPTURE_WORKFLOW.md)

---

## ⚠️ Notes

- This is a development build, not a Chrome Web Store release.
- AI provider payloads evolve frequently — adapters may need updates.
- Debug and telemetry surfaces never log raw payload text or sensitive values.
- Ollama must be running with `OLLAMA_ORIGINS="*"` for the extension to communicate with it.

---

## 📄 License

MIT
