import { normalizeWhitespace } from './utils.js';

const TITLE_PERSON_RE = /\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;
const CONTACT_PERSON_RE = /\b(?:contact|reach|with|call|email|attn)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/gi;
const ORG_SUFFIX_RE = /\b([A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,4}\s(?:Inc|LLC|Ltd|Corp|Corporation|Company|Co|Labs|Systems|Bank|University|Group|Technologies|Tech|Foundation|Partners))\b/g;
const PROJECT_TOKEN_RE = /\b(?:Project|Client|Vendor)\s+[A-Z][A-Za-z0-9_-]{2,}\b/g;
const CONTEXT_PERSON_RE = /\b(?:my name is|i am|i'm|this is)\s+([a-z][a-z'-]{1,24}(?:\s+[a-z][a-z'-]{1,24}){0,2})(?=\b(?:\s+(?:and|but|or|with|who|that|because|so|to|for|at|in|on|my|i)\b|[.,;!?]|$))/gi;
const CONTEXT_ORG_RE = /\b(?:i work for|i am at|i'm at|working at|employed by|company(?:\s+name)?\s+is|organization(?:\s+name)?\s+is)\s+([a-z0-9][a-z0-9&._-]*(?:\s+[a-z0-9][a-z0-9&._-]*){0,4})(?=\b(?:\s+(?:and|but|or|with|who|that|because|so|to|for|at|in|on|my|i)\b|[.,;!?]|$))/gi;
const CONTEXT_SECRET_RE = /\b(?:api\s*key|access\s*token|secret(?:\s*key)?|token)\s*(?:is|=|:)?\s*([a-z0-9._-]{4,})(?=\b(?:\s+(?:and|but|or|with|who|that|because|so|to|for|at|in|on|my|i)\b|[.,;!?]|$))/gi;

const PERSON_STOPWORDS = new Set([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  'Project',
  'Client',
  'Vendor',
  'fine',
  'good',
  'okay',
  'ok',
  'great',
  'bad',
  'happy',
  'sad',
  'tired',
  'ready',
  'interested',
  'looking',
  'trying',
  'and',
  'but',
  'or',
  'with',
  'who',
  'that',
  'because',
  'so',
  'to',
  'for',
  'at',
  'in',
  'on',
  'my',
  'i'
]);

const ORG_STOPWORDS = new Set([
  'company',
  'organization',
  'org',
  'business',
  'startup',
  'project',
  'client',
  'vendor'
]);

function cleanCandidate(value) {
  return normalizeWhitespace(String(value || '').replace(/[.,;:!?]+$/g, ''));
}

function looksLikePersonName(value) {
  const tokens = cleanCandidate(value).split(' ');
  if (tokens.length < 2 || tokens.length > 3) return false;
  for (const token of tokens) {
    if (PERSON_STOPWORDS.has(token)) return false;
    if (!/^[A-Z][a-z]+$/.test(token)) return false;
  }
  return true;
}

function looksLikeContextPerson(value) {
  const tokens = cleanCandidate(value).split(' ').filter(Boolean);
  if (tokens.length < 1 || tokens.length > 3) return false;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (!/^[a-z][a-z'-]{1,24}$/i.test(token)) return false;
    if (PERSON_STOPWORDS.has(token) || PERSON_STOPWORDS.has(lower)) return false;
    if (lower.endsWith('ing')) return false;
  }

  if (tokens.length === 1) {
    const one = tokens[0].toLowerCase();
    if (one.length < 3) return false;
    if (['fine', 'good', 'okay', 'ready', 'working'].includes(one)) return false;
  }

  return true;
}

function looksLikeContextOrg(value) {
  const tokens = cleanCandidate(value).split(' ').filter(Boolean);
  if (tokens.length < 1 || tokens.length > 5) return false;

  if (tokens.length === 1 && tokens[0].length < 3) return false;

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (!/^[a-z0-9][a-z0-9&._-]{1,30}$/i.test(token)) return false;
    if (ORG_STOPWORDS.has(lower)) return false;
  }

  return true;
}

function looksLikeContextSecret(value) {
  const candidate = cleanCandidate(value);
  if (!/^[A-Za-z0-9._-]{4,128}$/.test(candidate)) return false;

  // Numeric-only keys are allowed in explicit context, but should not be too short.
  if (/^\d+$/.test(candidate)) {
    return candidate.length >= 5;
  }

  if (candidate.length < 6) return false;
  return true;
}

function pushMatches(text, regex, type, confidence, list, captureGroup = 0, validateFn = null) {
  regex.lastIndex = 0;
  let match = regex.exec(text);
  while (match) {
    const raw = match[captureGroup];
    if (raw) {
      const value = cleanCandidate(raw);
      const start = match.index + match[0].indexOf(raw);
      const end = start + raw.length;
      if (value && (!validateFn || validateFn(value))) {
        list.push({ type, value, start, end, confidence, source: 'local-ner' });
      }
    }
    match = regex.exec(text);
  }
}

export function detectLocalEntities(text, options = {}) {
  if (!text || typeof text !== 'string') return [];

  const maxEntities = Number.isFinite(options.maxEntities) ? Math.max(1, Math.floor(options.maxEntities)) : 50;
  const entities = [];

  pushMatches(text, TITLE_PERSON_RE, 'PERSON', 0.91, entities, 1, looksLikePersonName);
  pushMatches(text, CONTACT_PERSON_RE, 'PERSON', 0.83, entities, 1, looksLikePersonName);
  pushMatches(text, CONTEXT_PERSON_RE, 'PERSON', 0.86, entities, 1, looksLikeContextPerson);
  pushMatches(text, ORG_SUFFIX_RE, 'ORGANIZATION', 0.88, entities, 1);
  pushMatches(text, CONTEXT_ORG_RE, 'ORGANIZATION', 0.87, entities, 1, looksLikeContextOrg);
  pushMatches(text, CONTEXT_SECRET_RE, 'API_KEY', 0.9, entities, 1, looksLikeContextSecret);
  pushMatches(text, PROJECT_TOKEN_RE, 'CUSTOM_TERM', 0.86, entities);

  if (entities.length > maxEntities) {
    return entities.slice(0, maxEntities);
  }
  return entities;
}
