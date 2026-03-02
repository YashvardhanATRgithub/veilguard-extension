import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../background/session-store.js';

test('SessionStore trims mappings when approximate session memory cap is exceeded', () => {
  const store = new SessionStore({
    ttlMs: 30 * 60 * 1000,
    maxSessions: 5,
    maxMappingsPerSession: 20,
    maxSessionBytesApprox: 280
  });

  const sessionKey = store.getSessionKey({
    tabId: 1,
    origin: 'https://chat.example.com',
    conversationId: 'conv-memory'
  });

  store.setMapping(sessionKey, {
    type: 'PERSON',
    real: 'Alice Johnson',
    fake: 'Avery Stone',
    createdAt: 1
  });

  store.setMapping(sessionKey, {
    type: 'ORGANIZATION',
    real: 'Blue Harbor Group',
    fake: 'Summit Dynamics',
    createdAt: 2
  });

  store.setMapping(sessionKey, {
    type: 'EMAIL',
    real: 'alice@acme.com',
    fake: 'jordan.reed10@example.test',
    createdAt: 3
  });

  const map = store.getFakeToRealMap({ sessionKey });
  const values = Object.values(map);

  // Oldest entries should be evicted first under memory pressure.
  assert.equal(values.includes('Alice Johnson'), false);
  assert.equal(values.includes('alice@acme.com'), true);
});
