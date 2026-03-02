export function fnv1a(input) {
  let hash = 0x811c9dc5;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function hashToRange(seed, min, max) {
  if (max <= min) return min;
  const span = max - min + 1;
  return min + (fnv1a(seed) % span);
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stablePick(seed, list) {
  if (!Array.isArray(list) || list.length === 0) return '';
  return list[fnv1a(seed) % list.length];
}

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

export function looksLikeJson(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
}
