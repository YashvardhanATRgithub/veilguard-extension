import { SessionStore } from './session-store.js';
import { transformOutgoingRequest } from './transform-engine.js';
import { createEmptyMetrics, normalizeMetrics, recordTransformMetric } from './metrics.js';

const SETTINGS_KEY = 'veilguardSettings';
const METRICS_KEY = 'veilguardMetrics';
const MAX_DEBUG_EVENTS = 200;

const OLLAMA_BASE = 'http://127.0.0.1:11434';

const DEFAULT_SETTINGS = {
  enabled: false,
  failPolicy: 'block',
  redactionMode: 'local_llm',
  localLlmEndpoint: OLLAMA_BASE + '/api/chat',
  localLlmModel: 'qwen2.5:1.5b',
  localLlmTimeoutMs: 15000,
  detectContextualNames: true,
  detectInternationalIban: true,
  enableLocalNer: true,
  customSensitiveTerms: [],
  minEntityConfidence: 0.7,
  ttlMs: 30 * 60 * 1000,
  maxPayloadChars: 1_000_000,
  maxSessionBytesApprox: 512 * 1024,
  maxSessions: 250,
  maxMappingsPerSession: 400,
  debug: false
};

let settings = { ...DEFAULT_SETTINGS };
const sessionStore = new SessionStore(settings);
const debugEvents = [];
let metrics = createEmptyMetrics();
let metricsPersistTimer = null;

function clampInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeTerms(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const normalized = entry.trim().replace(/\s+/g, ' ');
    if (normalized.length < 2) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= 250) break;
  }
  return output;
}

function normalizeSettings(next) {
  const merged = { ...DEFAULT_SETTINGS, ...(next || {}) };
  const minEntityConfidence = Number(merged.minEntityConfidence);
  const endpoint = String(merged.localLlmEndpoint || '').trim();
  const model = String(merged.localLlmModel || '').trim();
  return {
    enabled: !!merged.enabled,
    failPolicy: merged.failPolicy === 'pass' ? 'pass' : 'block',
    redactionMode: 'local_llm',
    localLlmEndpoint: endpoint || DEFAULT_SETTINGS.localLlmEndpoint,
    localLlmModel: model || DEFAULT_SETTINGS.localLlmModel,
    localLlmTimeoutMs: clampInt(merged.localLlmTimeoutMs, DEFAULT_SETTINGS.localLlmTimeoutMs, 1000, 60_000),
    detectContextualNames: merged.detectContextualNames !== false,
    detectInternationalIban: merged.detectInternationalIban !== false,
    enableLocalNer: merged.enableLocalNer !== false,
    customSensitiveTerms: normalizeTerms(merged.customSensitiveTerms),
    minEntityConfidence: Number.isFinite(minEntityConfidence)
      ? Math.min(1, Math.max(0, minEntityConfidence))
      : DEFAULT_SETTINGS.minEntityConfidence,
    ttlMs: clampInt(merged.ttlMs, DEFAULT_SETTINGS.ttlMs, 60 * 1000, 24 * 60 * 60 * 1000),
    maxPayloadChars: clampInt(merged.maxPayloadChars, DEFAULT_SETTINGS.maxPayloadChars, 20_000, 5_000_000),
    maxSessionBytesApprox: clampInt(
      merged.maxSessionBytesApprox,
      DEFAULT_SETTINGS.maxSessionBytesApprox,
      50_000,
      10_000_000
    ),
    maxSessions: clampInt(merged.maxSessions, DEFAULT_SETTINGS.maxSessions, 10, 5000),
    maxMappingsPerSession: clampInt(merged.maxMappingsPerSession, DEFAULT_SETTINGS.maxMappingsPerSession, 10, 10000),
    debug: !!merged.debug
  };
}

async function loadSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] || {};
  settings = normalizeSettings(stored);
  sessionStore.configure(settings);
}

async function loadMetrics() {
  const result = await chrome.storage.local.get(METRICS_KEY);
  metrics = normalizeMetrics(result[METRICS_KEY]);
}

async function persistSettings() {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function scheduleMetricsPersist() {
  if (metricsPersistTimer) return;
  metricsPersistTimer = setTimeout(async () => {
    metricsPersistTimer = null;
    try {
      await chrome.storage.local.set({ [METRICS_KEY]: metrics });
    } catch {
      // Ignore storage write failures to avoid affecting runtime transformations.
    }
  }, 3000);
}

function log(...args) {
  if (settings.debug) {
    console.log('[VeilGuard]', ...args);
  }
}

function setTransientBadge(tabId, replacements) {
  if (!Number.isFinite(tabId) || tabId < 0) return;
  const text = replacements > 0 ? String(Math.min(replacements, 99)) : '';
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#0ea5e9' }).catch(() => { });
  chrome.action.setBadgeText({ tabId, text }).catch(() => { });
  if (text) {
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => { });
    }, 2500);
  }
}

function pushDebugEvent(event) {
  debugEvents.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    ...event
  });

  if (debugEvents.length > MAX_DEBUG_EVENTS) {
    debugEvents.splice(0, debugEvents.length - MAX_DEBUG_EVENTS);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await loadSettings();
  await loadMetrics();
  await persistSettings();
  log('Installed with settings', settings);
});

chrome.runtime.onStartup.addListener(async () => {
  await loadSettings();
  await loadMetrics();
  log('Startup complete');
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SETTINGS_KEY]) return;
  settings = normalizeSettings(changes[SETTINGS_KEY].newValue || {});
  sessionStore.configure(settings);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sessionStore.clearTab(tabId);
});

function resolveOllamaBase(s) {
  const endpoint = s?.localLlmEndpoint || OLLAMA_BASE + '/api/chat';
  try {
    const u = new URL(endpoint);
    return u.origin;
  } catch {
    return OLLAMA_BASE;
  }
}

async function ollamaLoadModel(model) {
  // Just verify the model exists via /api/show (lightweight, no GPU load)
  const base = resolveOllamaBase(settings);
  const res = await fetch(base + '/api/show', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: model }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`ollama_model_not_found_${res.status}`);
  const data = await res.json();
  if (!data.modelfile && !data.template) throw new Error('ollama_model_invalid');
}

async function ollamaUnloadModel(model) {
  // Fire-and-forget: tell Ollama to free RAM
  const base = resolveOllamaBase(settings);
  try {
    fetch(base + '/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: 0 })
    }).catch(() => { });
  } catch { /* ignore */ }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    await loadSettings();

    switch (message?.type) {
      case 'VG_GET_SETTINGS': {
        sendResponse({ ok: true, settings });
        return;
      }
      case 'VG_SET_SETTINGS_PATCH': {
        const prevEnabled = settings.enabled;
        settings = normalizeSettings({ ...settings, ...(message.patch || {}) });
        sessionStore.configure(settings);
        await persistSettings();

        // Lifecycle: load/unload model on toggle
        if (settings.enabled && !prevEnabled) {
          ollamaLoadModel(settings.localLlmModel || 'qwen2.5:1.5b').catch(() => { });
        } else if (!settings.enabled && prevEnabled) {
          ollamaUnloadModel(settings.localLlmModel || 'qwen2.5:1.5b').catch(() => { });
        }

        sendResponse({ ok: true, settings });
        return;
      }
      case 'VG_TRANSFORM_OUTGOING': {
        const tabId = sender?.tab?.id ?? -1;
        const payload = {
          ...(message.payload || {}),
          tabId,
          origin: message?.payload?.origin || sender?.origin || 'unknown-origin'
        };

        const startedAt = performance.now();
        const transformed = await transformOutgoingRequest(payload, settings, sessionStore);
        const durationMs = performance.now() - startedAt;
        setTransientBadge(tabId, transformed.replacements || 0);

        pushDebugEvent({
          kind: 'transform',
          tabId,
          origin: payload.origin,
          url: payload.url,
          method: payload.method,
          action: transformed.action,
          adapterId: transformed.adapterId,
          replacements: transformed.replacements || 0,
          changed: !!transformed.changed,
          blocked: transformed.action === 'block',
          error: transformed.error || null
        });

        metrics = recordTransformMetric(metrics, {
          adapterId: transformed.adapterId || 'unknown',
          replacements: transformed.replacements || 0,
          changed: !!transformed.changed,
          blocked: transformed.action === 'block',
          error: transformed.error || null,
          durationMs
        });
        scheduleMetricsPersist();

        console.log('Sending VG_TRANSFORM_OUTGOING response:', JSON.stringify(transformed, null, 2));

        sendResponse({ ok: true, ...transformed });
        return;
      }
      case 'VG_GET_REHYDRATION_MAP': {
        const map = sessionStore.getFakeToRealMap({
          sessionKey: message.sessionKey || null,
          tabId: sender?.tab?.id,
          origin: message.origin || sender?.origin || null
        });
        sendResponse({ ok: true, map });
        return;
      }
      case 'VG_GET_DEBUG_EVENTS': {
        sendResponse({ ok: true, events: [...debugEvents].reverse() });
        return;
      }
      case 'VG_CLEAR_DEBUG_EVENTS': {
        debugEvents.length = 0;
        sendResponse({ ok: true });
        return;
      }
      case 'VG_GET_METRICS': {
        sendResponse({ ok: true, metrics });
        return;
      }
      case 'VG_RESET_METRICS': {
        metrics = createEmptyMetrics();
        scheduleMetricsPersist();
        sendResponse({ ok: true, metrics });
        return;
      }
      case 'VG_CLEAR_TAB_SESSIONS': {
        if (Number.isFinite(sender?.tab?.id)) {
          sessionStore.clearTab(sender.tab.id);
        }
        sendResponse({ ok: true });
        return;
      }
      case 'VG_GET_DEFAULTS': {
        sendResponse({ ok: true, defaults: DEFAULT_SETTINGS });
        return;
      }
      case 'VG_CHECK_OLLAMA': {
        try {
          const base = resolveOllamaBase(settings);
          const res = await fetch(base, { signal: AbortSignal.timeout(3000) });
          sendResponse({ ok: true, online: res.ok });
        } catch {
          sendResponse({ ok: true, online: false });
        }
        return;
      }
      case 'VG_LIST_MODELS': {
        try {
          const base = resolveOllamaBase(settings);
          const res = await fetch(base + '/api/tags', { signal: AbortSignal.timeout(5000) });
          const data = await res.json();
          const models = (data.models || []).map(m => ({ name: m.name, size: m.size }));
          sendResponse({ ok: true, models });
        } catch (e) {
          sendResponse({ ok: false, error: e.message, models: [] });
        }
        return;
      }
      case 'VG_LOAD_MODEL': {
        try {
          await ollamaLoadModel(message.model || settings.localLlmModel || 'qwen2.5:1.5b');
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return;
      }
      case 'VG_UNLOAD_MODEL': {
        try {
          await ollamaUnloadModel(message.model || settings.localLlmModel || 'qwen2.5:1.5b');
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return;
      }
      default:
        sendResponse({ ok: false, error: 'unknown_message_type' });
    }
  };

  run().catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  });

  return true;
});
