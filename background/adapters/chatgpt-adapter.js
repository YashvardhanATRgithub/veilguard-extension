import { cloneJson, findConversationId, getNormalizedRole, applyTransformToString } from './utils.js';

function looksLikeChatGptSchema(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) return false;

  return payload.messages.some((message) => {
    if (!message || typeof message !== 'object') return false;
    const hasAuthorRole = !!message?.author?.role;
    const hasChatGptContentShape = !!(
      message?.content &&
      typeof message.content === 'object' &&
      (Array.isArray(message.content.parts) || typeof message.content.content_type === 'string')
    );
    return hasAuthorRole && hasChatGptContentShape;
  });
}

function matches(url, payload) {
  const byUrl = /chatgpt\.com|openai\.com/i.test(url || '');
  if (byUrl) return true;
  return looksLikeChatGptSchema(payload);
}

async function transformPartValue(part, ctx) {
  if (typeof part === 'string') {
    return applyTransformToString(part, ctx);
  }

  if (!part || typeof part !== 'object') {
    return { value: part, replacements: 0 };
  }

  // Multimodal blocks: only transform textual fields and leave non-text data untouched.
  if (typeof part.text === 'string') {
    const transformed = await applyTransformToString(part.text, ctx);
    return {
      value: { ...part, text: transformed.value },
      replacements: transformed.replacements
    };
  }

  if (typeof part.content === 'string' && (part.type === 'text' || part.content_type === 'text')) {
    const transformed = await applyTransformToString(part.content, ctx);
    return {
      value: { ...part, content: transformed.value },
      replacements: transformed.replacements
    };
  }

  return { value: part, replacements: 0 };
}

async function transformMessageContent(message, ctx) {
  let replacements = 0;
  const role = getNormalizedRole(message);
  if (role && role !== 'user' && role !== 'human') return replacements;

  if (typeof message.content === 'string') {
    const transformed = await applyTransformToString(message.content, ctx);
    message.content = transformed.value;
    replacements += transformed.replacements;
    return replacements;
  }

  if (message.content && typeof message.content === 'object') {
    if (Array.isArray(message.content.parts)) {
      const transformedParts = [];
      for (const part of message.content.parts) {
        const transformed = await transformPartValue(part, ctx);
        replacements += transformed.replacements;
        transformedParts.push(transformed.value);
      }
      message.content.parts = transformedParts;
    }

    if (typeof message.content.text === 'string') {
      const transformed = await applyTransformToString(message.content.text, ctx);
      message.content.text = transformed.value;
      replacements += transformed.replacements;
    }
  }

  return replacements;
}

async function transformPayload(payload, ctx) {
  const out = cloneJson(payload);
  let replacements = 0;

  if (Array.isArray(out.messages)) {
    for (const message of out.messages) {
      replacements += await transformMessageContent(message, ctx);
    }
  }

  if (typeof out.prompt === 'string') {
    const transformed = await applyTransformToString(out.prompt, ctx);
    out.prompt = transformed.value;
    replacements += transformed.replacements;
  }

  if (out.input_text && typeof out.input_text === 'string') {
    const transformed = await applyTransformToString(out.input_text, ctx);
    out.input_text = transformed.value;
    replacements += transformed.replacements;
  }

  if (out.input && typeof out.input === 'string') {
    const transformed = await applyTransformToString(out.input, ctx);
    out.input = transformed.value;
    replacements += transformed.replacements;
  }

  return { payload: out, replacements };
}

export const chatgptAdapter = {
  id: 'chatgpt',
  matches,
  extractConversationId(payload) {
    return findConversationId(payload);
  },
  transformPayload
};
