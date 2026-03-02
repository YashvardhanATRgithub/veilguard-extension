import { hashToRange, stablePick } from './utils.js';

const FIRST_NAMES = ['Avery', 'Jordan', 'Taylor', 'Morgan', 'Cameron', 'Logan', 'Riley', 'Casey', 'Skyler', 'Drew'];
const LAST_NAMES = ['Reed', 'Parker', 'Hayes', 'Brooks', 'Carter', 'Bennett', 'Sawyer', 'Foster', 'Quinn', 'Morrison'];
const COMPANIES = ['Northstar Labs', 'Summit Dynamics', 'Blue Harbor Group', 'Signal Ridge', 'Everfield Systems', 'Maple Crest Co'];
const STREETS = ['Cedar Lane', 'Oak Street', 'Riverview Drive', 'Willow Avenue', 'Highland Road', 'Maple Court'];
const PROJECTS = ['Project Atlas', 'Project Orion', 'Project Juniper', 'Project Nimbus', 'Project Ember', 'Project Harbor'];

function digitsOnly(value) {
  return String(value).replace(/\D/g, '');
}

function luhnCheckDigit(numberWithoutCheck) {
  let sum = 0;
  let shouldDouble = true;
  for (let i = numberWithoutCheck.length - 1; i >= 0; i -= 1) {
    let digit = Number(numberWithoutCheck[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return (10 - (sum % 10)) % 10;
}

function generateLuhnNumber(seed, targetLength) {
  const length = Math.max(13, Math.min(targetLength, 19));
  let base = String(hashToRange(seed, 10 ** Math.max(0, length - 2), (10 ** Math.max(0, length - 1)) - 1));
  base = base.padStart(length - 1, '7').slice(0, length - 1);
  const check = luhnCheckDigit(base);
  return `${base}${check}`;
}

function formatLikeOriginalDigits(original, rawDigits) {
  let idx = 0;
  let output = '';
  for (const ch of original) {
    if (/\d/.test(ch)) {
      output += rawDigits[idx] ?? '0';
      idx += 1;
    } else {
      output += ch;
    }
  }
  if (idx < rawDigits.length) {
    output += rawDigits.slice(idx);
  }
  return output;
}

function formatLikeOriginalAlphaNum(original, raw) {
  let idx = 0;
  let output = '';

  for (const ch of original) {
    if (/[A-Za-z0-9]/.test(ch)) {
      output += raw[idx] ?? 'X';
      idx += 1;
    } else {
      output += ch;
    }
  }

  if (idx < raw.length) {
    output += raw.slice(idx);
  }

  return output;
}

function fakeEmail(seed) {
  const first = stablePick(`${seed}:email:first`, FIRST_NAMES).toLowerCase();
  const last = stablePick(`${seed}:email:last`, LAST_NAMES).toLowerCase();
  const suffix = hashToRange(`${seed}:email:num`, 10, 99);
  return `${first}.${last}${suffix}@example.test`;
}

function fakePerson(seed) {
  const first = stablePick(`${seed}:person:first`, FIRST_NAMES);
  const last = stablePick(`${seed}:person:last`, LAST_NAMES);
  return `${first} ${last}`;
}

function fakePhone(realValue, seed) {
  const raw = digitsOnly(realValue);
  const length = raw.length >= 10 ? raw.length : 10;
  let generated = '';
  for (let i = 0; i < length; i += 1) {
    generated += String(hashToRange(`${seed}:phone:${i}`, 0, 9));
  }
  if (raw.length > 0) {
    return formatLikeOriginalDigits(realValue, generated.slice(0, raw.length));
  }
  return generated;
}

function fakeSsn(seed) {
  const a = hashToRange(`${seed}:ssn:a`, 100, 899);
  const b = hashToRange(`${seed}:ssn:b`, 10, 99);
  const c = hashToRange(`${seed}:ssn:c`, 1000, 9999);
  return `${a}-${b}-${c}`;
}

function fakeCreditCard(realValue, seed) {
  const raw = digitsOnly(realValue);
  const number = generateLuhnNumber(seed, raw.length || 16);
  if (!raw) return number;
  return formatLikeOriginalDigits(realValue, number.slice(0, raw.length));
}

function fakeAddress(seed) {
  const number = hashToRange(`${seed}:addr:num`, 100, 9999);
  const street = stablePick(`${seed}:addr:street`, STREETS);
  return `${number} ${street}`;
}

function fakeOrganization(seed) {
  return stablePick(`${seed}:org`, COMPANIES);
}

function fakeApiKey(seed, realValue) {
  if (realValue.startsWith('sk-')) {
    let token = 'sk-';
    for (let i = 0; i < Math.max(realValue.length - 3, 20); i += 1) {
      token += String.fromCharCode(97 + hashToRange(`${seed}:api:${i}`, 0, 25));
    }
    return token;
  }
  if (realValue.startsWith('ghp_')) {
    let token = 'ghp_';
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < 36; i += 1) {
      token += chars[hashToRange(`${seed}:gh:${i}`, 0, chars.length - 1)];
    }
    return token;
  }
  return `token_${hashToRange(`${seed}:t`, 100000, 999999)}`;
}

function ibanMod97(iban) {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;

  for (const char of rearranged) {
    let digits = '';
    if (char >= '0' && char <= '9') {
      digits = char;
    } else if (char >= 'A' && char <= 'Z') {
      digits = String(char.charCodeAt(0) - 55);
    } else {
      return Number.NaN;
    }

    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  return remainder;
}

function fakeIban(realValue, seed) {
  const source = String(realValue || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const length = Math.max(15, Math.min(source.length || 22, 34));
  const country = /^[A-Z]{2}/.test(source) ? source.slice(0, 2) : 'DE';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  let bban = '';
  for (let i = 0; i < length - 4; i += 1) {
    const idx = hashToRange(`${seed}:iban:${i}`, 0, chars.length - 1);
    bban += chars[idx];
  }

  const provisional = `${country}00${bban}`;
  const mod = ibanMod97(provisional);
  const check = String(98 - mod).padStart(2, '0');
  const canonical = `${country}${check}${bban}`;

  if (!source) {
    return canonical.replace(/(.{4})/g, '$1 ').trim();
  }

  return formatLikeOriginalAlphaNum(realValue, canonical);
}

function fakeCustomTerm(seed) {
  return stablePick(`${seed}:custom`, PROJECTS);
}

function fakeGeneric(seed) {
  return `redacted_${hashToRange(`${seed}:generic`, 1000, 9999)}`;
}

export function generateFakeValue(entity, sessionSeed = '') {
  const seed = `${sessionSeed}:${entity.type}:${entity.value}`;
  switch (entity.type) {
    case 'EMAIL':
      return fakeEmail(seed);
    case 'PHONE':
      return fakePhone(entity.value, seed);
    case 'SSN':
      return fakeSsn(seed);
    case 'CREDIT_CARD':
      return fakeCreditCard(entity.value, seed);
    case 'ADDRESS':
      return fakeAddress(seed);
    case 'ORGANIZATION':
      return fakeOrganization(seed);
    case 'API_KEY':
      return fakeApiKey(seed, entity.value);
    case 'PERSON':
      return fakePerson(seed);
    case 'IBAN':
      return fakeIban(entity.value, seed);
    case 'CUSTOM_TERM':
      return fakeCustomTerm(seed);
    default:
      return fakeGeneric(seed);
  }
}
