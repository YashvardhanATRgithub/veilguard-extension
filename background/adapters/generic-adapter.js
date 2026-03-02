import { cloneJson } from './utils.js';

const CANDIDATE_KEYS = new Set([
  'prompt',
  'input',
  'message',
  'content',
  'text',
  'query',
  'instruction',
  'question',
  'user_input'
]);

const USER_ROLES = new Set(['user', 'human']);
const NON_USER_ROLES = new Set(['assistant', 'system', 'developer', 'tool', 'model']);

function extractConversationId(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const keys = ['conversation_id', 'conversationId', 'thread_id', 'threadId', 'chat_id', 'chatId', 'session_id', 'sessionId'];
  for (const key of keys) {
    if (payload[key] != null) return String(payload[key]);
  }

  return null;
}

function shouldTransform(context) {
  const key = String(context.key || '').toLowerCase();
  const role = typeof context.role === 'string' ? context.role.toLowerCase() : null;

  if (role && NON_USER_ROLES.has(role)) return false;
  if (CANDIDATE_KEYS.has(key)) {
    if (!role) return true;
    return USER_ROLES.has(role);
  }

  if (context.path.includes('messages') && (key === 'text' || key === 'content')) {
    if (!role) return true;
    return USER_ROLES.has(role);
  }

  return false;
}

async function traverse(value, context, onString) {
  if (typeof value === 'string') {
    return onString(value, context);
  }

  if (Array.isArray(value)) {
    const output = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      output.push(await traverse(item, {
        ...context,
        key: String(index),
        path: [...context.path, `[${index}]`]
      }, onString));
    }
    return output;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const nextRole = typeof value.role === 'string' ? value.role.toLowerCase() : context.role;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = await traverse(child, {
      key,
      role: nextRole,
      path: [...context.path, key]
    }, onString);
  }

  return output;
}

async function transformPayload(payload, ctx) {
  const out = cloneJson(payload);
  let replacements = 0;

  const transformedPayload = await traverse(out, { key: '', role: null, path: [] }, async (value, context) => {
    if (!shouldTransform(context)) return value;
    const transformed = await ctx.transformText(value);
    replacements += transformed.replacements;
    return transformed.text;
  });

  return { payload: transformedPayload, replacements };
}

export const genericAdapter = {
  id: 'generic',
  matches() {
    return true;
  },
  extractConversationId,
  transformPayload
};
