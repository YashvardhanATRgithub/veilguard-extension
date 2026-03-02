import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../background/session-store.js';
import { transformOutgoingRequest } from '../background/transform-engine.js';
import { installLocalLlmFetchMock } from './helpers/local-llm-fetch-mock.js';

const settings = {
  enabled: true,
  failPolicy: 'block',
  redactionMode: 'local_llm',
  localLlmEndpoint: 'http://127.0.0.1:11434/api/chat',
  localLlmModel: 'qwen2.5:0.5b',
  localLlmTimeoutMs: 8000,
  detectContextualNames: true,
  detectInternationalIban: true,
  enableLocalNer: true,
  customSensitiveTerms: [],
  minEntityConfidence: 0.7,
  ttlMs: 30 * 60 * 1000,
  maxPayloadChars: 1_000_000,
  maxSessionBytesApprox: 512 * 1024,
  maxSessions: 50,
  maxMappingsPerSession: 200,
  debug: false
};

let restoreFetch = null;

before(() => {
  restoreFetch = installLocalLlmFetchMock();
});

after(() => {
  if (typeof restoreFetch === 'function') restoreFetch();
});

test('transformOutgoingRequest masks user content and preserves non-user role content', async () => {
  const store = new SessionStore(settings);

  const payload = {
    conversation_id: 'conv-1',
    messages: [
      { role: 'system', content: 'System key sk-AAAAAAAAAAAAAAAAAAAA should remain unchanged.' },
      { role: 'user', content: 'my name is John Doe and my email is john.doe@acme.com' }
    ]
  };

  const response = await transformOutgoingRequest(
    {
      url: 'https://chat.example.com/conversation',
      method: 'POST',
      bodyText: JSON.stringify(payload),
      origin: 'https://chat.example.com',
      tabId: 7
    },
    settings,
    store
  );

  assert.equal(response.action, 'allow');
  assert.equal(response.changed, true);
  assert.ok(response.replacements > 0);
  assert.ok(response.sessionKey);

  const transformed = JSON.parse(response.bodyText);
  assert.equal(
    transformed.messages[0].content,
    payload.messages[0].content,
    'system messages should not be transformed'
  );
  assert.notEqual(
    transformed.messages[1].content,
    payload.messages[1].content,
    'user message should be transformed'
  );

  const map = response.fakeToRealMap;
  const realValues = Object.values(map);
  assert.equal(realValues.includes('John Doe'), true);
  assert.equal(realValues.includes('john.doe@acme.com'), true);
});

test('mapping remains stable for repeated values in same session', async () => {
  const store = new SessionStore(settings);

  const requestPayload = {
    conversation_id: 'conv-2',
    messages: [{ role: 'user', content: 'Email me at sam@company.org' }]
  };

  const first = await transformOutgoingRequest(
    {
      url: 'https://chat.example.com/messages',
      method: 'POST',
      bodyText: JSON.stringify(requestPayload),
      origin: 'https://chat.example.com',
      tabId: 2
    },
    settings,
    store
  );

  const second = await transformOutgoingRequest(
    {
      url: 'https://chat.example.com/messages',
      method: 'POST',
      bodyText: JSON.stringify(requestPayload),
      origin: 'https://chat.example.com',
      tabId: 2
    },
    settings,
    store
  );

  assert.equal(first.sessionKey, second.sessionKey);
  assert.equal(first.bodyText, second.bodyText);
});

test('transformOutgoingRequest masks IBAN and custom sensitive terms', async () => {
  const store = new SessionStore(settings);
  const withCustomTerms = {
    ...settings,
    customSensitiveTerms: ['Project Helios']
  };

  const payload = {
    messages: [
      {
        role: 'user',
        content: 'Project Helios uses account DE89 3704 0044 0532 0130 00.'
      }
    ]
  };

  const response = await transformOutgoingRequest(
    {
      url: 'https://chat.example.com/messages',
      method: 'POST',
      bodyText: JSON.stringify(payload),
      origin: 'https://chat.example.com',
      tabId: 22
    },
    withCustomTerms,
    store
  );

  assert.equal(response.changed, true);
  assert.ok(response.replacements >= 2);

  const transformed = JSON.parse(response.bodyText);
  const content = transformed.messages[0].content;
  assert.equal(content.includes('Project Helios'), false);
  assert.equal(content.includes('DE89 3704 0044 0532 0130 00'), false);
});

test('transformOutgoingRequest honors minEntityConfidence threshold', async () => {
  const store = new SessionStore(settings);
  const strictSettings = {
    ...settings,
    minEntityConfidence: 0.9
  };

  const payload = {
    messages: [
      {
        role: 'user',
        content: 'My name is Alice Johnson.'
      }
    ]
  };

  const response = await transformOutgoingRequest(
    {
      url: 'https://chat.example.com/messages',
      method: 'POST',
      bodyText: JSON.stringify(payload),
      origin: 'https://chat.example.com',
      tabId: 23
    },
    strictSettings,
    store
  );

  assert.equal(response.changed, false);
  assert.equal(response.replacements, 0);
});

test('transformOutgoingRequest masks local-NER-only entities when enabled', async () => {
  const store = new SessionStore(settings);
  const localNerSettings = {
    ...settings,
    enableLocalNer: true,
    detectContextualNames: false,
    customSensitiveTerms: [],
    minEntityConfidence: 0.8
  };

  const payload = {
    messages: [
      {
        role: 'user',
        content: 'Please contact Dr. Elena Stone at Blue Harbor Group.'
      }
    ]
  };

  const response = await transformOutgoingRequest(
    {
      url: 'https://chat.example.com/messages',
      method: 'POST',
      bodyText: JSON.stringify(payload),
      origin: 'https://chat.example.com',
      tabId: 24
    },
    localNerSettings,
    store
  );

  assert.equal(response.changed, true);
  assert.ok(response.replacements >= 2);

  const transformed = JSON.parse(response.bodyText);
  const content = transformed.messages[0].content;
  assert.equal(content.includes('Elena Stone'), false);
  assert.equal(content.includes('Blue Harbor Group'), false);
});

test('transformOutgoingRequest skips very large payloads safely', async () => {
  const store = new SessionStore(settings);
  const strict = {
    ...settings,
    maxPayloadChars: 80
  };

  const payload = {
    messages: [
      { role: 'user', content: 'my email is large.payload.user@example.com and this message is intentionally long.' }
    ]
  };

  const bodyText = JSON.stringify(payload);
  const response = await transformOutgoingRequest(
    {
      url: 'https://chat.example.com/messages',
      method: 'POST',
      bodyText,
      origin: 'https://chat.example.com',
      tabId: 29
    },
    strict,
    store
  );

  assert.equal(response.changed, false);
  assert.equal(response.bodyText, bodyText);
  assert.equal(response.skippedReason, 'payload_too_large');
});
