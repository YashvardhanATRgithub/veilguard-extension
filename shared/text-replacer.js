import { escapeRegExp } from './utils.js';

export function applyReplacements(text, replacements) {
  if (!Array.isArray(replacements) || replacements.length === 0) {
    return { text, count: 0 };
  }

  const sorted = [...replacements].sort((a, b) => b.start - a.start);
  let output = text;
  for (const item of sorted) {
    output = output.slice(0, item.start) + item.replacement + output.slice(item.end);
  }
  return { text: output, count: sorted.length };
}

function replacementRegexFor(fakeValue) {
  const escaped = escapeRegExp(fakeValue);
  const startsWord = /[A-Za-z0-9]/.test(fakeValue[0] || '');
  const endsWord = /[A-Za-z0-9]/.test(fakeValue[fakeValue.length - 1] || '');

  if (startsWord && endsWord) {
    return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'g');
  }
  return new RegExp(escaped, 'g');
}

export function rehydrateText(text, fakeToRealMap) {
  if (!text || typeof text !== 'string') return { text, count: 0 };
  const keys = Object.keys(fakeToRealMap || {});
  if (keys.length === 0) return { text, count: 0 };

  const sortedKeys = keys.sort((a, b) => b.length - a.length);
  let output = text;
  let count = 0;

  for (const fake of sortedKeys) {
    const real = fakeToRealMap[fake];
    if (!real) continue;
    const regex = replacementRegexFor(fake);
    output = output.replace(regex, () => {
      count += 1;
      return real;
    });
  }

  return { text: output, count };
}

export function rehydrateSegmentedText(segments, fakeToRealMap) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { segments: Array.isArray(segments) ? [...segments] : [], count: 0, changed: false };
  }

  const original = segments.join('');
  const result = rehydrateText(original, fakeToRealMap);
  if (result.count === 0) {
    return { segments: [...segments], count: 0, changed: false };
  }

  const nextSegments = [];
  let cursor = 0;

  for (let i = 0; i < segments.length; i += 1) {
    if (i === segments.length - 1) {
      nextSegments.push(result.text.slice(cursor));
      continue;
    }

    const length = segments[i].length;
    nextSegments.push(result.text.slice(cursor, cursor + length));
    cursor += length;
  }

  return {
    segments: nextSegments,
    count: result.count,
    changed: true
  };
}
