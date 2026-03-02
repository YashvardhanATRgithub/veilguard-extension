import test from 'node:test';
import assert from 'node:assert/strict';
import { rehydrateSegmentedText } from '../shared/text-replacer.js';

test('rehydrateSegmentedText rehydrates fake values split across segments', () => {
  const segments = ['Hello ', 'Avery', ' Sto', 'ne, welcome back.'];
  const map = {
    'Avery Stone': 'Jane Doe'
  };

  const result = rehydrateSegmentedText(segments, map);
  assert.equal(result.changed, true);
  assert.equal(result.count, 1);

  const output = result.segments.join('');
  assert.equal(output.includes('Avery Stone'), false);
  assert.equal(output.includes('Jane Doe'), true);
});


test('rehydrateSegmentedText prefers longest fake token first', () => {
  const segments = ['IDs: redacted_1234 and redacted_12'];
  const map = {
    redacted_12: 'TOKEN_B',
    redacted_1234: 'TOKEN_A'
  };

  const result = rehydrateSegmentedText(segments, map);
  const output = result.segments.join('');

  assert.equal(output, 'IDs: TOKEN_A and TOKEN_B');
});
