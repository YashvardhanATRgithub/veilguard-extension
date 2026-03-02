import { detectPII } from './pii-detector.js';
import { generateFakeValue } from './fake-generator.js';
import { applyReplacements } from './text-replacer.js';

function allocateFake(entity, state) {
  const key = `${entity.type}:${entity.value}`;
  const existing = state.realToFake.get(key);
  if (existing) return existing;

  let attempt = 0;
  let fake = '';

  while (attempt < 5) {
    const seed = attempt === 0 ? state.seed : `${state.seed}:${attempt}`;
    fake = generateFakeValue(entity, seed);
    const occupied = state.fakeToRealKey.get(fake);
    if ((!occupied || occupied === key) && fake !== entity.value) {
      state.realToFake.set(key, fake);
      state.fakeToRealKey.set(fake, key);
      return fake;
    }
    attempt += 1;
  }

  const fallback = `redacted_${1000 + state.fakeToRealKey.size}`;
  state.realToFake.set(key, fallback);
  state.fakeToRealKey.set(fallback, key);
  return fallback;
}

function sanitizeText(text, state, options) {
  const entities = detectPII(text, {
    detectContextualNames: options.detectContextualNames,
    detectInternationalIban: options.detectInternationalIban,
    customSensitiveTerms: options.customSensitiveTerms,
    minConfidence: options.minConfidence,
    enableLocalNer: options.enableLocalNer
  });
  if (entities.length === 0) return text;

  const replacements = entities.map((entity) => ({
    start: entity.start,
    end: entity.end,
    replacement: allocateFake(entity, state)
  }));

  const result = applyReplacements(text, replacements);
  state.replacements += result.count;
  return result.text;
}

function sanitizeNode(node, state, depth, options) {
  if (depth > options.maxDepth) return node;

  if (typeof node === 'string') {
    return sanitizeText(node, state, options);
  }

  if (Array.isArray(node)) {
    return node.map((entry) => sanitizeNode(entry, state, depth + 1, options));
  }

  if (!node || typeof node !== 'object') {
    return node;
  }

  if (state.seen.has(node)) {
    return node;
  }

  state.seen.add(node);

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = sanitizeNode(value, state, depth + 1, options);
  }

  state.seen.delete(node);
  return out;
}

export function sanitizeCapturedPayload(payload, options = {}) {
  const config = {
    seed: options.seed || 'capture',
    maxDepth: Number.isFinite(options.maxDepth) ? options.maxDepth : 32,
    detectContextualNames: options.detectContextualNames !== false,
    detectInternationalIban: options.detectInternationalIban !== false,
    customSensitiveTerms: Array.isArray(options.customSensitiveTerms) ? options.customSensitiveTerms : [],
    minConfidence: Number.isFinite(options.minConfidence) ? options.minConfidence : 0,
    enableLocalNer: options.enableLocalNer !== false
  };

  const state = {
    seed: config.seed,
    replacements: 0,
    realToFake: new Map(),
    fakeToRealKey: new Map(),
    seen: new WeakSet()
  };

  const value = sanitizeNode(payload, state, 0, config);
  return { value, replacements: state.replacements };
}
