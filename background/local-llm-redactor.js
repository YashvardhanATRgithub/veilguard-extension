import { ollamaFetch } from './ollama-fetch.js';
const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434/api/chat';
const DEFAULT_MODEL = 'qwen2.5:1.5b';
const DEFAULT_TIMEOUT_MS = 60000;

const REDACTION_SYSTEM_PROMPT = [
  'You find private information VALUES in text.',
  'Redact the actual SECRET VALUES, NOT the labels describing them.',
  'For "my api key is sk-12345", redact "sk-12345" (the value), NOT "api key" (the label).',
  'For "her name is priya", redact "priya" (the name), NOT "her" (the pronoun).',
  'Private values include: person names, city names, street addresses, company names, email addresses, phone numbers, API keys, passwords, tokens, IBANs, SSNs, credit card numbers.',
  'Return JSON: {"replacements": [{"real": "exact_value_from_text", "fake": "TYPE_N", "type": "TYPE"}]}',
  'Types: PERSON, LOCATION, ORG, EMAIL, PHONE, KEY, PASSWORD, SSN, IBAN, CARD.'
].join('\\n');

function safeParseJson(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeType(value) {
  const fallback = 'GENERIC';
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return fallback;
  if (!/^[A-Z_]{2,40}$/.test(normalized)) return fallback;
  return normalized;
}

function normalizeReplacement(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const real = String(entry.real ?? '').trim();
  const fake = String(entry.fake ?? '').trim();
  if (!real || !fake || real === fake) return null;
  return {
    real,
    fake,
    type: normalizeType(entry.type)
  };
}

function extractModelPayload(data) {
  if (!data || typeof data !== 'object') return null;

  let direct = safeParseJson(data.message?.content) || safeParseJson(data.response);
  if (!direct) {
    if (Array.isArray(data.sensitive)) {
      direct = data;
    } else if (Array.isArray(data.replacements)) {
      return data;
    } else {
      return null;
    }
  }

  if (Array.isArray(direct.sensitive)) {
    const replacements = [];
    let counter = 1;
    for (const real of direct.sensitive) {
      if (typeof real !== 'string' || !real.trim()) continue;

      let type = 'GENERIC';
      const r = real.trim();
      if (r.startsWith('sk-') || r.length > 20) type = 'KEY';
      else if (r.includes('@')) type = 'EMAIL';
      else if (/^[A-Z]/.test(r)) type = 'PERSON'; // naive heuristic 

      replacements.push({
        real: r,
        fake: `${type}_${counter}`,
        type
      });
      counter++;
    }
    return { replacements };
  }

  // Fallback if it somehow still outputs replacements
  if (Array.isArray(direct.replacements)) {
    return direct;
  }

  return null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeOutput(raw, originalText) {
  const replacements = Array.isArray(raw?.replacements)
    ? raw.replacements.map(normalizeReplacement).filter(Boolean)
    : [];

  let text = originalText;
  for (const r of replacements) {
    const escaped = escapeRegExp(r.real);
    const startsWord = /[A-Za-z0-9]/.test(r.real[0] || '');
    const endsWord = /[A-Za-z0-9]/.test(r.real[r.real.length - 1] || '');
    const pattern = startsWord && endsWord
      ? new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi')
      : new RegExp(escaped, 'gi');

    text = text.replace(pattern, r.fake);
  }

  if (text !== originalText && replacements.length === 0) {
    throw new Error('local_llm_missing_mappings');
  }

  return { text, replacements };
}

function resolveEndpoint(settings) {
  const candidate = String(settings?.localLlmEndpoint || DEFAULT_ENDPOINT).trim();
  return candidate || DEFAULT_ENDPOINT;
}

function resolveModel(settings) {
  const candidate = String(settings?.localLlmModel || DEFAULT_MODEL).trim();
  return candidate || DEFAULT_MODEL;
}

function resolveTimeout(settings) {
  const parsed = Number(settings?.localLlmTimeoutMs);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(60_000, Math.max(1000, Math.round(parsed)));
}

export async function redactWithLocalLlm({ text, settings }) {
  if (typeof text !== 'string' || !text) {
    return { text, replacements: [] };
  }

  const endpoint = resolveEndpoint(settings);
  const model = resolveModel(settings);
  const timeoutMs = resolveTimeout(settings);
  const hints = {
    detectContextualNames: settings?.detectContextualNames !== false,
    detectInternationalIban: settings?.detectInternationalIban !== false,
    enableLocalNer: settings?.enableLocalNer !== false,
    customSensitiveTerms: Array.isArray(settings?.customSensitiveTerms) ? settings.customSensitiveTerms : [],
    minConfidence: Number(settings?.minEntityConfidence)
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await ollamaFetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        options: {
          temperature: 0
        },
        _detection_hints: hints,
        messages: [
          {
            role: 'system',
            content: REDACTION_SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: text
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`local_llm_http_${response.status}`);
    }

    const data = await response.json();
    const payload = extractModelPayload(data);
    if (!payload) {
      throw new Error('local_llm_invalid_output');
    }

    return normalizeOutput(payload, text);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('local_llm_timeout');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
