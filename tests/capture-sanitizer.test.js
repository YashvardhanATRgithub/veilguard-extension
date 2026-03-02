import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCapturedPayload } from '../shared/capture-sanitizer.js';

test('sanitizeCapturedPayload masks nested strings and keeps repeated mapping stable', () => {
  const payload = {
    messages: [
      {
        role: 'user',
        content: 'My name is John Doe and my email is john.doe@acme.com. Call +1 (415) 555-0199.'
      },
      {
        role: 'user',
        content: 'Please use john.doe@acme.com and address 123 Main Street.'
      }
    ],
    metadata: {
      note: 'Card 4111 1111 1111 1111 should not remain as-is.'
    }
  };

  const result = sanitizeCapturedPayload(payload, { seed: 'unit-capture' });
  const json = JSON.stringify(result.value);

  assert.ok(result.replacements >= 5);
  assert.equal(json.includes('John Doe'), false);
  assert.equal(json.includes('john.doe@acme.com'), false);
  assert.equal(json.includes('+1 (415) 555-0199'), false);
  assert.equal(json.includes('123 Main Street'), false);
  assert.equal(json.includes('4111 1111 1111 1111'), false);

  const firstEmail = result.value.messages[0].content.match(/\b[^\s]+@example\.test\b/)[0];
  const secondEmail = result.value.messages[1].content.match(/\b[^\s]+@example\.test\b/)[0];
  assert.equal(firstEmail, secondEmail);

  assert.equal(payload.messages[0].content.includes('john.doe@acme.com'), true);
});

test('sanitizeCapturedPayload handles non-object input', () => {
  const text = 'Reach me at jane@company.org or +1 212-555-0133';
  const result = sanitizeCapturedPayload(text, { seed: 'unit-capture' });

  assert.equal(typeof result.value, 'string');
  assert.equal(result.value.includes('jane@company.org'), false);
  assert.equal(result.value.includes('+1 212-555-0133'), false);
  assert.ok(result.replacements >= 2);
});
