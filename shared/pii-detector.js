import { escapeRegExp, normalizeWhitespace } from './utils.js';
import { detectLocalEntities } from './local-ner.js';

export const ENTITY_TYPES = {
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  SSN: 'SSN',
  CREDIT_CARD: 'CREDIT_CARD',
  ADDRESS: 'ADDRESS',
  API_KEY: 'API_KEY',
  PERSON: 'PERSON',
  ORGANIZATION: 'ORGANIZATION',
  IBAN: 'IBAN',
  CUSTOM_TERM: 'CUSTOM_TERM'
};

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?<!\d)(?:\+?\d{1,2}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const CREDIT_CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;
const ADDRESS_RE = /\b\d{1,5}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way)\b/gi;
const API_KEY_RE = /\b(?:sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{35}|ghp_[A-Za-z0-9]{36})\b/g;
const CONTEXTUAL_NAME_RE = /\b(?:[Mm]y name is|[Ii] am|[Ii]'m|[Tt]his is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g;
const IBAN_RE = /\b[A-Za-z]{2}\d{2}(?:[\s-]?[A-Z0-9]){10,30}\b/g;
const CONFIDENCE_BY_TYPE = {
  [ENTITY_TYPES.EMAIL]: 0.99,
  [ENTITY_TYPES.PHONE]: 0.96,
  [ENTITY_TYPES.SSN]: 0.99,
  [ENTITY_TYPES.CREDIT_CARD]: 0.99,
  [ENTITY_TYPES.ADDRESS]: 0.9,
  [ENTITY_TYPES.API_KEY]: 0.99,
  [ENTITY_TYPES.PERSON]: 0.74,
  [ENTITY_TYPES.ORGANIZATION]: 0.86,
  [ENTITY_TYPES.IBAN]: 0.97,
  [ENTITY_TYPES.CUSTOM_TERM]: 0.995
};

function luhnValid(number) {
  const digits = number.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (shouldDouble) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function pushRegexMatches(text, regex, type, list, filterFn, normalizeValueFn) {
  regex.lastIndex = 0;
  let match = regex.exec(text);
  while (match) {
    const raw = match[0];
    if (raw) {
      const normalized = normalizeValueFn ? normalizeValueFn(raw) : normalizeWhitespace(raw);
      const displayValue = normalizeWhitespace(raw);
      const start = match.index;
      const end = start + raw.length;
      if (normalized && (!filterFn || filterFn(normalized, raw))) {
        list.push({
          type,
          value: displayValue,
          start,
          end,
          confidence: CONFIDENCE_BY_TYPE[type] || 0.8
        });
      }
    }
    match = regex.exec(text);
  }
}

function normalizeIban(value) {
  return String(value || '').replace(/[\s-]+/g, '').toUpperCase();
}

function ibanMod97(iban) {
  const normalized = normalizeIban(iban);
  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  let remainder = 0;

  for (const char of rearranged) {
    let digits = '';
    if (char >= '0' && char <= '9') {
      digits = char;
    } else if (char >= 'A' && char <= 'Z') {
      digits = String(char.charCodeAt(0) - 55);
    } else {
      return Number.NaN;
    }

    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  return remainder;
}

function looksLikeValidIban(value) {
  const normalized = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(normalized)) return false;
  return ibanMod97(normalized) === 1;
}

function normalizeCustomTerms(terms) {
  if (!Array.isArray(terms)) return [];

  const seen = new Set();
  const output = [];

  for (const entry of terms) {
    if (typeof entry !== 'string') continue;
    const normalized = normalizeWhitespace(entry);
    if (normalized.length < 2) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }

  return output.sort((a, b) => b.length - a.length);
}

function customTermToRegex(term) {
  const tokens = normalizeWhitespace(term).split(' ').map(escapeRegExp);
  const body = tokens.join('\\s+');
  const startsWord = /[A-Za-z0-9]/.test(term[0] || '');
  const endsWord = /[A-Za-z0-9]/.test(term[term.length - 1] || '');
  const prefix = startsWord ? '(?<![A-Za-z0-9])' : '';
  const suffix = endsWord ? '(?![A-Za-z0-9])' : '';
  return new RegExp(`${prefix}${body}${suffix}`, 'gi');
}

function pushCustomTerms(text, list, terms) {
  const normalizedTerms = normalizeCustomTerms(terms);
  for (const term of normalizedTerms) {
    const regex = customTermToRegex(term);
    regex.lastIndex = 0;

    let match = regex.exec(text);
    while (match) {
      const start = match.index;
      const end = start + match[0].length;
      list.push({
        type: ENTITY_TYPES.CUSTOM_TERM,
        value: term,
        start,
        end,
        confidence: CONFIDENCE_BY_TYPE[ENTITY_TYPES.CUSTOM_TERM]
      });
      match = regex.exec(text);
    }
  }
}

function pushContextualNames(text, list) {
  CONTEXTUAL_NAME_RE.lastIndex = 0;
  let match = CONTEXTUAL_NAME_RE.exec(text);
  while (match) {
    const captured = normalizeWhitespace(match[1] || '');
    if (captured) {
      const start = text.indexOf(captured, match.index);
      if (start >= 0) {
        list.push({
          type: ENTITY_TYPES.PERSON,
          value: captured,
          start,
          end: start + captured.length,
          confidence: CONFIDENCE_BY_TYPE[ENTITY_TYPES.PERSON]
        });
      }
    }
    match = CONTEXTUAL_NAME_RE.exec(text);
  }
}

function entitySpan(entity) {
  return entity.end - entity.start;
}

function entityConfidence(entity) {
  return Number(entity.confidence || 0);
}

function isHigherPriority(candidate, current) {
  const c1 = entityConfidence(candidate);
  const c2 = entityConfidence(current);
  if (Math.abs(c1 - c2) > 1e-6) return c1 > c2;

  const span1 = entitySpan(candidate);
  const span2 = entitySpan(current);
  if (span1 !== span2) return span1 > span2;

  // Deterministic tie-breaker.
  return String(candidate.type) < String(current.type);
}

function removeOverlaps(entities) {
  const sorted = [...entities].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (Math.abs(entityConfidence(a) - entityConfidence(b)) > 1e-6) {
      return entityConfidence(b) - entityConfidence(a);
    }
    return entitySpan(b) - entitySpan(a);
  });

  const result = [];
  for (const entity of sorted) {
    const last = result[result.length - 1];
    if (!last || entity.start >= last.end) {
      result.push(entity);
      continue;
    }

    if (isHigherPriority(entity, last)) {
      result[result.length - 1] = entity;
    }
  }

  return result;
}

export function detectPII(text, options = {}) {
  if (!text || typeof text !== 'string') return [];

  const entities = [];
  pushRegexMatches(text, EMAIL_RE, ENTITY_TYPES.EMAIL, entities);
  pushRegexMatches(
    text,
    PHONE_RE,
    ENTITY_TYPES.PHONE,
    entities,
    (normalized) => normalized.replace(/\D/g, '').length >= 10
  );
  pushRegexMatches(text, SSN_RE, ENTITY_TYPES.SSN, entities);
  pushRegexMatches(text, CREDIT_CARD_RE, ENTITY_TYPES.CREDIT_CARD, entities, (normalized) => luhnValid(normalized));
  pushRegexMatches(text, ADDRESS_RE, ENTITY_TYPES.ADDRESS, entities);
  pushRegexMatches(text, API_KEY_RE, ENTITY_TYPES.API_KEY, entities);
  if (options.detectInternationalIban !== false) {
    pushRegexMatches(text, IBAN_RE, ENTITY_TYPES.IBAN, entities, (normalized) => looksLikeValidIban(normalized), normalizeIban);
  }

  if (options.detectContextualNames !== false) {
    pushContextualNames(text, entities);
  }

  if (Array.isArray(options.customSensitiveTerms) && options.customSensitiveTerms.length > 0) {
    pushCustomTerms(text, entities, options.customSensitiveTerms);
  }

  if (options.enableLocalNer !== false) {
    try {
      const localEntities = detectLocalEntities(text, {
        maxEntities: options.maxLocalNerEntities
      });
      for (const entity of localEntities) {
        entities.push(entity);
      }
    } catch {
      // Fallback chain: if local NER fails, continue with deterministic rule entities only.
    }
  }

  const deduped = new Map();
  for (const entity of entities) {
    const key = `${entity.type}:${entity.start}:${entity.end}:${entity.value}`;
    if (!deduped.has(key)) deduped.set(key, entity);
  }

  const minConfidence = Number.isFinite(options.minConfidence) ? options.minConfidence : 0;
  return removeOverlaps([...deduped.values()]).filter((entity) => {
    return (entity.confidence || 0) >= minConfidence;
  });
}
