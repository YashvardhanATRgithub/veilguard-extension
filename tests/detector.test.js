import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPII, ENTITY_TYPES } from '../shared/pii-detector.js';

test('detectPII finds common sensitive entities', () => {
  const input = [
    'Contact me at jane.doe@company.com',
    'or +1 (415) 555-0199.',
    'SSN 123-45-6789 and card 4111 1111 1111 1111.'
  ].join(' ');

  const entities = detectPII(input);
  const types = new Set(entities.map((e) => e.type));

  assert.equal(types.has(ENTITY_TYPES.EMAIL), true);
  assert.equal(types.has(ENTITY_TYPES.PHONE), true);
  assert.equal(types.has(ENTITY_TYPES.SSN), true);
  assert.equal(types.has(ENTITY_TYPES.CREDIT_CARD), true);
});

test('detectPII detects contextual person names', () => {
  const input = "Hi, My name is Alice Johnson and I need help.";
  const entities = detectPII(input, { detectContextualNames: true });

  const person = entities.find((e) => e.type === ENTITY_TYPES.PERSON);
  assert.ok(person);
  assert.equal(person.value, 'Alice Johnson');
  assert.ok(person.confidence < 0.8);
});

test('detectPII detects valid IBAN values', () => {
  const input = 'Use account DE89 3704 0044 0532 0130 00 for refund.';
  const entities = detectPII(input);

  const iban = entities.find((e) => e.type === ENTITY_TYPES.IBAN);
  assert.ok(iban);
  assert.equal(iban.value, 'DE89 3704 0044 0532 0130 00');
});

test('detectPII detects configured custom sensitive terms', () => {
  const input = 'Project Helios is delayed. project helios needs escalation.';
  const entities = detectPII(input, {
    customSensitiveTerms: ['Project Helios']
  });

  const terms = entities.filter((e) => e.type === ENTITY_TYPES.CUSTOM_TERM);
  assert.equal(terms.length, 2);
  assert.equal(terms[0].value, 'Project Helios');
  assert.ok(terms[0].confidence > 0.99);
});

test('detectPII respects minimum confidence threshold', () => {
  const input = 'My name is Alice Johnson and my email is alice@acme.com.';
  const entities = detectPII(input, { minConfidence: 0.9 });

  const hasPerson = entities.some((e) => e.type === ENTITY_TYPES.PERSON);
  const hasEmail = entities.some((e) => e.type === ENTITY_TYPES.EMAIL);
  assert.equal(hasPerson, false);
  assert.equal(hasEmail, true);
});

test('detectPII local NER detects organization suffix entities', () => {
  const input = 'Coordinate with Blue Harbor Group and Summit Dynamics LLC today.';
  const entities = detectPII(input, {
    enableLocalNer: true,
    minConfidence: 0.8
  });

  const orgs = entities.filter((e) => e.type === ENTITY_TYPES.ORGANIZATION);
  assert.ok(orgs.length >= 1);
  assert.equal(orgs.some((e) => e.value.includes('Blue Harbor Group')), true);
});

test('detectPII can disable local NER fallback detector', () => {
  const input = 'Please contact Dr. Elena Stone for approval.';
  const enabled = detectPII(input, { enableLocalNer: true, minConfidence: 0.8 });
  const disabled = detectPII(input, { enableLocalNer: false, minConfidence: 0.8 });

  assert.equal(enabled.some((e) => e.type === ENTITY_TYPES.PERSON), true);
  assert.equal(disabled.some((e) => e.type === ENTITY_TYPES.PERSON), false);
});
