import { isObject } from '../../shared/utils.js';

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function applyTransformToString(value, ctx) {
  if (typeof value !== 'string' || !value) {
    return { value, replacements: 0 };
  }
  const transformed = await ctx.transformText(value);
  return { value: transformed.text, replacements: transformed.replacements };
}

export function getNormalizedRole(message) {
  if (!isObject(message)) return null;

  if (typeof message.role === 'string') {
    return message.role.toLowerCase();
  }

  if (isObject(message.author) && typeof message.author.role === 'string') {
    return message.author.role.toLowerCase();
  }

  return null;
}

export function findConversationId(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const keys = [
    'conversation_id',
    'conversationId',
    'thread_id',
    'threadId',
    'chat_id',
    'chatId',
    'session_id',
    'sessionId',
    'conversation_uuid'
  ];

  for (const key of keys) {
    if (payload[key] != null && (typeof payload[key] === 'string' || typeof payload[key] === 'number')) {
      return String(payload[key]);
    }
  }

  return null;
}

export function safeTraverse(value, visitor, state = { path: [] }) {
  if (typeof value === 'string') {
    return visitor(value, state);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => safeTraverse(item, visitor, { ...state, path: [...state.path, `[${index}]`] }));
  }

  if (!isObject(value)) {
    return value;
  }

  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = safeTraverse(child, visitor, { ...state, key, path: [...state.path, key] });
  }

  return output;
}
