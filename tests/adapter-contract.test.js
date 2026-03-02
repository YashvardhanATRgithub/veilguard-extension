import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
  maxSessions: 100,
  maxMappingsPerSession: 300,
  debug: false
};

let restoreFetch = null;

before(() => {
  restoreFetch = installLocalLlmFetchMock();
});

after(() => {
  if (typeof restoreFetch === 'function') restoreFetch();
});

function readFixture(name) {
  const file = path.join(process.cwd(), 'tests', 'fixtures', name);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function runTransform({ url, fixtureName, tabId }) {
  const store = new SessionStore(settings);
  const payload = readFixture(fixtureName);
  const response = await transformOutgoingRequest(
    {
      url,
      method: 'POST',
      bodyText: JSON.stringify(payload),
      origin: new URL(url).origin,
      tabId
    },
    settings,
    store
  );

  return { response, original: payload, transformed: JSON.parse(response.bodyText) };
}

test('chatgpt adapter contract: transforms user parts only', async () => {
  const { response, original, transformed } = await runTransform({
    url: 'https://chatgpt.com/backend-api/conversation',
    fixtureName: 'chatgpt.request.json',
    tabId: 11
  });

  assert.equal(response.adapterId, 'chatgpt');
  assert.equal(response.changed, true);
  assert.ok(response.replacements > 0);

  assert.equal(
    transformed.messages[0].content.parts[0],
    original.messages[0].content.parts[0],
    'system message must stay unchanged'
  );

  const transformedUser = transformed.messages[1].content.parts[0];
  assert.notEqual(transformedUser, original.messages[1].content.parts[0]);
  assert.equal(transformedUser.includes('jane.doe@acme.com'), false);
  assert.equal(transformedUser.includes('+1 (415) 555-0199'), false);
  assert.equal(transformedUser.includes('Jane Doe'), false);
});

test('chatgpt adapter contract: keeps multimodal non-text blocks unchanged', async () => {
  const { response, transformed } = await runTransform({
    url: 'https://chatgpt.com/backend-api/conversation',
    fixtureName: 'chatgpt.multimodal.request.json',
    tabId: 15
  });

  assert.equal(response.adapterId, 'chatgpt');
  assert.equal(response.changed, true);

  const parts = transformed.messages[0].content.parts;
  assert.equal(parts[0].text.includes('ava@example.com'), false);
  assert.deepEqual(parts[1], {
    type: 'image_url',
    image_url: { url: 'https://cdn.example.com/photo.png' }
  });
  assert.equal(String(parts[2]).includes('sk-CCCCCCCCCCCCCCCCCCCC'), false);
});

test('claude adapter contract: transforms user text blocks only', async () => {
  const { response, original, transformed } = await runTransform({
    url: 'https://claude.ai/api/organizations/x/chat_conversations/y/completion',
    fixtureName: 'claude.request.json',
    tabId: 12
  });

  assert.equal(response.adapterId, 'claude');
  assert.equal(response.changed, true);

  assert.equal(
    transformed.messages[0].content[0].text,
    original.messages[0].content[0].text,
    'assistant block must stay unchanged'
  );

  const transformedUser = transformed.messages[1].content[0].text;
  assert.equal(transformedUser.includes('123-45-6789'), false);
  assert.equal(transformedUser.includes('123 Main Street'), false);
});

test('claude adapter contract: leaves tool_use blocks untouched', async () => {
  const { response, transformed } = await runTransform({
    url: 'https://claude.ai/api/organizations/x/chat_conversations/y/completion',
    fixtureName: 'claude.tooluse.request.json',
    tabId: 16
  });

  assert.equal(response.adapterId, 'claude');
  assert.equal(response.changed, true);

  const blocks = transformed.messages[0].content;
  assert.equal(blocks[0].text.includes('900 Market Street'), false);
  assert.deepEqual(blocks[1], {
    type: 'tool_use',
    id: 'toolu_1',
    name: 'calendar_lookup',
    input: { email: 'dont-change@tool.local' }
  });
});

test('gemini adapter contract: transforms user parts and preserves model parts', async () => {
  const { response, original, transformed } = await runTransform({
    url: 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate',
    fixtureName: 'gemini.request.json',
    tabId: 13
  });

  assert.equal(response.adapterId, 'gemini');
  assert.equal(response.changed, true);

  assert.equal(
    transformed.contents[0].parts[0].text,
    original.contents[0].parts[0].text,
    'model part must stay unchanged'
  );

  const transformedUser = transformed.contents[1].parts[0].text;
  assert.equal(transformedUser.includes('bob@example.com'), false);
  assert.equal(transformedUser.includes('4111 1111 1111 1111'), false);
});

test('gemini adapter contract: handles nested generateContentRequest payloads', async () => {
  const { response, transformed, original } = await runTransform({
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
    fixtureName: 'gemini.nested.request.json',
    tabId: 17
  });

  assert.equal(response.adapterId, 'gemini');
  assert.equal(response.changed, true);

  const userParts = transformed.generateContentRequest.contents[0].parts;
  assert.equal(userParts[0].text.includes('liam@corp.com'), false);
  assert.deepEqual(userParts[1], original.generateContentRequest.contents[0].parts[1]);
  assert.equal(userParts[2].text.includes('4111-1111-1111-1111'), false);

  const modelPart = transformed.generateContentRequest.contents[1].parts[0].text;
  assert.equal(modelPart, original.generateContentRequest.contents[1].parts[0].text);
});

test('generic adapter contract: transforms user content on unknown providers', async () => {
  const { response, original, transformed } = await runTransform({
    url: 'https://unknown-ai.example.com/v1/messages',
    fixtureName: 'generic.request.json',
    tabId: 14
  });

  assert.equal(response.adapterId, 'generic');
  assert.equal(response.changed, true);

  assert.equal(transformed.messages[0].content, original.messages[0].content);
  assert.equal(transformed.messages[1].content.includes('Alice Johnson'), false);
  assert.equal(transformed.messages[1].content.includes('sk-BBBBBBBBBBBBBBBBBBBB'), false);
});

test('generic adapter contract: does not mutate tool_calls structures', async () => {
  const { response, transformed, original } = await runTransform({
    url: 'https://unknown-ai.example.com/v2/chat',
    fixtureName: 'generic.toolcall.request.json',
    tabId: 18
  });

  assert.equal(response.adapterId, 'generic');
  assert.equal(response.changed, true);
  assert.equal(transformed.messages[0].content.includes('Noah Reed'), false);
  assert.deepEqual(transformed.messages[0].tool_calls, original.messages[0].tool_calls);
});
