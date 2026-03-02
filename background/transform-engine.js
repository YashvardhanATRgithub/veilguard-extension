import { looksLikeJson } from '../shared/utils.js';
import { resolveAdapter } from './adapters/index.js';
import { redactWithLocalLlm } from './local-llm-redactor.js';

const CHAT_ENDPOINT_HINTS = [
  /chat/i,
  /conversation/i,
  /message/i,
  /prompt/i,
  /completion/i,
  /generate/i,
  /assistant/i,
  /claude/i,
  /gemini/i,
  /openai/i,
  /anthropic/i,
  /generativelanguage/i
];

function isLikelyChatRequest(url, bodyText) {
  const byUrl = CHAT_ENDPOINT_HINTS.some((pattern) => pattern.test(url || ''));
  if (byUrl) return true;
  return /"messages"\s*:|"prompt"\s*:|"content"\s*:|"contents"\s*:/i.test(bodyText || '');
}

function addMappingsToSessionStore(sessionStore, sessionKey, replacements) {
  const unique = new Set();
  let count = 0;
  const now = Date.now();

  for (const row of replacements || []) {
    if (!row || typeof row !== 'object') continue;
    const real = String(row.real ?? '').trim();
    const fake = String(row.fake ?? '').trim();
    const type = String(row.type ?? 'GENERIC').trim().toUpperCase() || 'GENERIC';
    if (!real || !fake || real === fake) continue;

    const key = `${type}:${real}:${fake}`;
    if (unique.has(key)) continue;
    unique.add(key);

    sessionStore.setMapping(sessionKey, {
      type,
      real,
      fake,
      createdAt: now
    });
    count += 1;
  }

  return count;
}

function buildLocalLlmTextTransformer(sessionStore, sessionKey, settings) {
  return async function transformTextWithLocalLlm(text) {
    const output = await redactWithLocalLlm({ text, settings });
    const count = addMappingsToSessionStore(sessionStore, sessionKey, output.replacements);
    return {
      text: output.text,
      changed: output.text !== text,
      replacements: count
    };
  };
}

function buildTextTransformer(sessionStore, sessionKey, settings) {
  return buildLocalLlmTextTransformer(sessionStore, sessionKey, settings);
}

function baseResponse(bodyText) {
  return {
    action: 'allow',
    bodyText,
    changed: false,
    replacements: 0,
    sessionKey: null,
    fakeToRealMap: {},
    adapterId: null
  };
}

export async function transformOutgoingRequest(request, settings, sessionStore) {
  const method = String(request.method || 'GET').toUpperCase();
  const bodyText = typeof request.bodyText === 'string' ? request.bodyText : '';

  if (!settings.enabled) return baseResponse(bodyText);

  if (!['POST', 'PUT', 'PATCH', 'WS_SEND'].includes(method)) {
    return baseResponse(bodyText);
  }

  if (!bodyText) return baseResponse(bodyText);

  const maxPayloadChars = Number.isFinite(settings.maxPayloadChars) ? settings.maxPayloadChars : 1_000_000;
  if (bodyText.length > maxPayloadChars) {
    return {
      ...baseResponse(bodyText),
      skippedReason: 'payload_too_large'
    };
  }

  const origin = request.origin || 'unknown-origin';

  try {
    if (looksLikeJson(bodyText)) {
      const payload = JSON.parse(bodyText);
      const adapter = resolveAdapter(request.url, payload);
      const conversationId = adapter.extractConversationId(payload);
      const sessionKey = sessionStore.getSessionKey({
        tabId: request.tabId,
        origin,
        conversationId
      });

      const transformText = buildTextTransformer(sessionStore, sessionKey, settings);
      const transformed = await adapter.transformPayload(payload, {
        transformText,
        request,
        settings
      });

      const changed = transformed.replacements > 0;
      return {
        action: 'allow',
        bodyText: changed ? JSON.stringify(transformed.payload) : bodyText,
        changed,
        replacements: transformed.replacements,
        sessionKey,
        fakeToRealMap: sessionStore.getFakeToRealMap({ sessionKey }),
        adapterId: adapter.id
      };
    }

    if (!isLikelyChatRequest(request.url, bodyText)) {
      return baseResponse(bodyText);
    }

    const sessionKey = sessionStore.getSessionKey({
      tabId: request.tabId,
      origin,
      conversationId: null
    });

    const transformText = buildTextTransformer(sessionStore, sessionKey, settings);
    const transformed = await transformText(bodyText);

    return {
      action: 'allow',
      bodyText: transformed.text,
      changed: transformed.changed,
      replacements: transformed.replacements,
      sessionKey,
      fakeToRealMap: sessionStore.getFakeToRealMap({ sessionKey }),
      adapterId: 'raw-text'
    };
  } catch (error) {
    if (settings.failPolicy === 'block') {
      return {
        action: 'block',
        reason: 'transform_error',
        error: error instanceof Error ? error.message : String(error),
        bodyText,
        changed: false,
        replacements: 0,
        sessionKey: null,
        fakeToRealMap: {},
        adapterId: null
      };
    }

    return {
      ...baseResponse(bodyText),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
