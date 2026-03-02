import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { rehydrateSegmentedText } from '../shared/text-replacer.js';

const RESPONSE_FIXTURE_NAMES = [
  'chatgpt.stream.segmented.json',
  'claude-long-stream.json',
  'multi-token-overlap.json'
];

function readFixture(name) {
  const file = path.join(process.cwd(), 'tests', 'fixtures', 'responses', name);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fragmentText(text, pattern) {
  const out = [];
  let cursor = 0;
  let index = 0;

  while (cursor < text.length) {
    const width = pattern[index % pattern.length];
    out.push(text.slice(cursor, cursor + width));
    cursor += width;
    index += 1;
  }

  return out;
}

function countLiteralOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;

  while (cursor < text.length) {
    const found = text.indexOf(needle, cursor);
    if (found === -1) break;
    count += 1;
    cursor = found + needle.length;
  }

  return count;
}

test('response replay fixture corpus rehydrates to expected output', () => {
  for (const name of RESPONSE_FIXTURE_NAMES) {
    const fixture = readFixture(name);
    const result = rehydrateSegmentedText(fixture.segments, fixture.map);
    const output = result.segments.join('');

    assert.equal(result.changed, true, `${name} should report changed=true`);
    assert.ok(result.count > 0, `${name} should replace at least one token`);
    assert.equal(output, fixture.expected, `${name} output mismatch`);

    for (const fake of Object.keys(fixture.map)) {
      assert.equal(output.includes(fake), false, `${name} still contains fake token: ${fake}`);
    }

    const secondPass = rehydrateSegmentedText(result.segments, fixture.map);
    assert.equal(secondPass.changed, false, `${name} should be idempotent on second pass`);
    assert.equal(secondPass.count, 0, `${name} second pass should not replace more tokens`);
  }
});

test('rehydration remains correct under extreme token fragmentation', () => {
  const pattern = [1, 2, 1, 3, 5, 2, 1, 4, 2];

  for (const name of RESPONSE_FIXTURE_NAMES) {
    const fixture = readFixture(name);
    const source = fixture.segments.join('');
    const fragmented = fragmentText(source, pattern);
    const result = rehydrateSegmentedText(fragmented, fixture.map);

    assert.equal(result.segments.join(''), fixture.expected, `${name} fragmented output mismatch`);
  }
});

test('long-response stress replay replaces every mapped token', () => {
  const fixture = readFixture('claude-long-stream.json');
  const source = fixture.segments.join('');
  const repeats = 120;
  const expanded = Array.from({ length: repeats }, () => source).join(' ');
  const fragmented = fragmentText(expanded, [1, 3, 2, 5, 8, 13, 3, 2, 1]);

  const result = rehydrateSegmentedText(fragmented, fixture.map);
  const output = result.segments.join('');

  for (const fake of Object.keys(fixture.map)) {
    assert.equal(output.includes(fake), false, `stress output still contains fake token: ${fake}`);
  }

  for (const real of Object.values(fixture.map)) {
    assert.equal(output.includes(real), true, `stress output should contain real token: ${real}`);
  }

  const expectedReplacementCount = Object.keys(fixture.map).reduce((sum, fake) => {
    return sum + countLiteralOccurrences(expanded, fake);
  }, 0);

  assert.equal(result.count, expectedReplacementCount);
});
