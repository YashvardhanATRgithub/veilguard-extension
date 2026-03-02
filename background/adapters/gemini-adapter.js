import { cloneJson, findConversationId, applyTransformToString } from './utils.js';

function looksLikeGeminiSchema(payload) {
  if (!payload || typeof payload !== 'object') return false;

  if (Array.isArray(payload.contents)) {
    return payload.contents.some((item) => Array.isArray(item?.parts));
  }

  const nested = payload.generateContentRequest;
  if (nested && typeof nested === 'object' && Array.isArray(nested.contents)) {
    return nested.contents.some((item) => Array.isArray(item?.parts));
  }

  return false;
}

function matches(url, payload) {
  const byUrl = /gemini\.google\.com|generativelanguage|bard/i.test(url || '');
  if (byUrl) return true;
  return looksLikeGeminiSchema(payload);
}

async function transformParts(parts, ctx) {
  let replacements = 0;
  if (!Array.isArray(parts)) return { parts, replacements };

  const transformed = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') {
      transformed.push(part);
      continue;
    }
    if (typeof part.text !== 'string') {
      transformed.push(part);
      continue;
    }

    const result = await applyTransformToString(part.text, ctx);
    replacements += result.replacements;
    transformed.push({ ...part, text: result.value });
  }

  return { parts: transformed, replacements };
}

async function transformContents(contents, ctx) {
  let replacements = 0;
  if (!Array.isArray(contents)) return { contents, replacements };

  const transformed = [];
  for (const entry of contents) {
    if (!entry || typeof entry !== 'object') {
      transformed.push(entry);
      continue;
    }
    const role = typeof entry.role === 'string' ? entry.role.toLowerCase() : null;
    if (role && role !== 'user') {
      transformed.push(entry);
      continue;
    }

    const updated = await transformParts(entry.parts, ctx);
    replacements += updated.replacements;
    transformed.push({ ...entry, parts: updated.parts });
  }

  return { contents: transformed, replacements };
}

async function transformPayload(payload, ctx) {
  const out = cloneJson(payload);
  let replacements = 0;

  const topLevel = await transformContents(out.contents, ctx);
  out.contents = topLevel.contents;
  replacements += topLevel.replacements;

  if (out.generateContentRequest && typeof out.generateContentRequest === 'object') {
    const nested = await transformContents(out.generateContentRequest.contents, ctx);
    out.generateContentRequest.contents = nested.contents;
    replacements += nested.replacements;
  }

  if (typeof out.prompt === 'string') {
    const transformed = await applyTransformToString(out.prompt, ctx);
    out.prompt = transformed.value;
    replacements += transformed.replacements;
  }

  return { payload: out, replacements };
}

export const geminiAdapter = {
  id: 'gemini',
  matches,
  extractConversationId(payload) {
    return findConversationId(payload);
  },
  transformPayload
};
