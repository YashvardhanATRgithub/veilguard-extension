import { detectPII } from '../../shared/pii-detector.js';
import { generateFakeValue } from '../../shared/fake-generator.js';
import { applyReplacements } from '../../shared/text-replacer.js';

function parseJsonOrNull(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractTextFromRequestBody(rawBody) {
  const payload = parseJsonOrNull(rawBody);
  if (!payload || typeof payload !== 'object') return { text: '', hints: {} };
  if (!Array.isArray(payload.messages)) return { text: '', hints: {} };

  for (let i = payload.messages.length - 1; i >= 0; i -= 1) {
    const message = payload.messages[i];
    if (!message || typeof message !== 'object') continue;
    if (message.role !== 'user') continue;

    const parsed = parseJsonOrNull(message.content);
    if (parsed && typeof parsed.text === 'string') {
      return {
        text: parsed.text,
        hints: parsed.hints && typeof parsed.hints === 'object' ? parsed.hints : {}
      };
    }
  }

  return { text: '', hints: {} };
}

function buildRedactionResult(text, hints, state) {
  if (!text) return { text, replacements: [] };

  const entities = detectPII(text, {
    detectContextualNames: hints.detectContextualNames !== false,
    detectInternationalIban: hints.detectInternationalIban !== false,
    enableLocalNer: hints.enableLocalNer !== false,
    customSensitiveTerms: Array.isArray(hints.customSensitiveTerms) ? hints.customSensitiveTerms : [],
    minConfidence: Number.isFinite(Number(hints.minConfidence)) ? Number(hints.minConfidence) : 0
  });

  if (entities.length === 0) {
    return { text, replacements: [] };
  }

  const replacements = [];
  const map = [];
  for (const entity of entities) {
    const key = `${entity.type}:${entity.value}`;
    let fake = state.entityToFake.get(key);
    if (!fake) {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const candidate = generateFakeValue(entity, attempt === 0 ? 'mock-llm' : `mock-llm:${attempt}`);
        if (!candidate || candidate === entity.value) continue;
        const existing = state.fakeToReal.get(candidate);
        if (existing && existing !== entity.value) continue;
        fake = candidate;
        break;
      }

      if (!fake) {
        fake = generateFakeValue({ type: 'GENERIC', value: entity.value }, 'mock-llm:fallback');
      }

      state.entityToFake.set(key, fake);
      state.fakeToReal.set(fake, entity.value);
    }

    replacements.push({
      start: entity.start,
      end: entity.end,
      replacement: fake
    });
    map.push({
      real: entity.value,
      fake,
      type: entity.type
    });
  }

  const applied = applyReplacements(text, replacements);
  return {
    text: applied.text,
    replacements: map
  };
}

export function installLocalLlmFetchMock() {
  const originalFetch = globalThis.fetch;
  const state = {
    entityToFake: new Map(),
    fakeToReal: new Map()
  };

  globalThis.fetch = async (_url, init = {}) => {
    const request = extractTextFromRequestBody(String(init?.body || ''));
    const output = buildRedactionResult(request.text, request.hints, state);

    return {
      ok: true,
      status: 200,
      async json() {
        return output;
      }
    };
  };

  return function restoreFetch() {
    globalThis.fetch = originalFetch;
  };
}
