import { cloneJson, findConversationId, applyTransformToString } from './utils.js';

function looksLikeClaudeSchema(payload) {
  if (!payload || typeof payload !== 'object') return false;

  if (payload.message && Array.isArray(payload.message.content)) {
    return payload.message.content.some((block) => block && typeof block === 'object' && block.type === 'text');
  }

  if (!Array.isArray(payload.messages)) return false;
  return payload.messages.some((message) => {
    if (!message || typeof message !== 'object') return false;
    if (!Array.isArray(message.content)) return false;
    return message.content.some((block) => block && typeof block === 'object' && block.type === 'text');
  });
}

function matches(url, payload) {
  const byUrl = /claude\.ai|anthropic/i.test(url || '');
  if (byUrl) return true;
  return looksLikeClaudeSchema(payload);
}

async function transformContentBlocks(content, ctx) {
  let replacements = 0;

  if (typeof content === 'string') {
    const transformed = await applyTransformToString(content, ctx);
    return { content: transformed.value, replacements: transformed.replacements };
  }

  if (!Array.isArray(content)) {
    return { content, replacements };
  }

  const next = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      next.push(block);
      continue;
    }

    // Tool and non-text blocks remain unchanged.
    if (block.type !== 'text' || typeof block.text !== 'string') {
      next.push(block);
      continue;
    }

    const transformed = await applyTransformToString(block.text, ctx);
    replacements += transformed.replacements;
    next.push({ ...block, text: transformed.value });
  }

  return { content: next, replacements };
}

async function transformPayload(payload, ctx) {
  const out = cloneJson(payload);
  let replacements = 0;

  if (typeof out.prompt === 'string') {
    const transformed = await applyTransformToString(out.prompt, ctx);
    out.prompt = transformed.value;
    replacements += transformed.replacements;
  }

  if (Array.isArray(out.messages)) {
    const nextMessages = [];
    for (const message of out.messages) {
      if (!message || typeof message !== 'object') {
        nextMessages.push(message);
        continue;
      }
      const role = typeof message.role === 'string' ? message.role.toLowerCase() : null;
      if (role && role !== 'user' && role !== 'human') {
        nextMessages.push(message);
        continue;
      }

      const transformed = await transformContentBlocks(message.content, ctx);
      replacements += transformed.replacements;
      nextMessages.push({ ...message, content: transformed.content });
    }
    out.messages = nextMessages;
  }

  if (out.message && typeof out.message === 'object') {
    const role = typeof out.message.role === 'string' ? out.message.role.toLowerCase() : 'user';
    if (role === 'user' || role === 'human') {
      const transformed = await transformContentBlocks(out.message.content, ctx);
      replacements += transformed.replacements;
      out.message = { ...out.message, content: transformed.content };
    }
  }

  return { payload: out, replacements };
}

export const claudeAdapter = {
  id: 'claude',
  matches,
  extractConversationId(payload) {
    return findConversationId(payload);
  },
  transformPayload
};
