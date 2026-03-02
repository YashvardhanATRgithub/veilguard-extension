import fs from 'node:fs';
import path from 'node:path';
import { resolveAdapter } from '../../background/adapters/index.js';
import { sanitizeCapturedPayload } from '../../shared/capture-sanitizer.js';

const PROVIDERS = ['auto', 'chatgpt', 'claude', 'gemini', 'generic'];
const KINDS = ['request', 'response'];

const PROVIDER_HINTS = {
  chatgpt: /chatgpt\.com|openai\.com/i,
  claude: /claude\.ai|anthropic/i,
  gemini: /gemini\.google\.com|generativelanguage|bard/i,
  generic: /./
};

function usage() {
  return [
    'Usage:',
    '  node scripts/corpus/import-har.js --har <file.har> --name <fixture-name> [options]',
    '',
    'Options:',
    '  --kind <request|response>    Capture body kind (default: request)',
    '  --provider <auto|chatgpt|claude|gemini|generic> (default: auto)',
    '  --index <n>                  Candidate entry index after filtering (default: 0)',
    '  --out <path>                 Output fixture path',
    '  --help                       Show this message'
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    kind: 'request',
    provider: 'auto',
    index: 0,
    har: '',
    name: '',
    out: ''
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--help') {
      args.help = true;
      continue;
    }

    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[i + 1];
    if (value == null || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    if (key === 'index') {
      args.index = Number(value);
    } else if (key in args) {
      args[key] = value;
    } else {
      throw new Error(`Unknown option: --${key}`);
    }

    i += 1;
  }

  if (args.help) return args;

  if (!args.har) throw new Error('Missing required --har');
  if (!args.name) throw new Error('Missing required --name');
  if (!KINDS.includes(args.kind)) throw new Error(`Invalid --kind: ${args.kind}`);
  if (!PROVIDERS.includes(args.provider)) throw new Error(`Invalid --provider: ${args.provider}`);
  if (!Number.isInteger(args.index) || args.index < 0) {
    throw new Error(`Invalid --index: ${args.index}`);
  }

  return args;
}

function readJson(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(text);
}

function safeUrlWithoutQuery(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return String(url || '');
  }
}

function decodeResponseText(content) {
  if (!content || typeof content.text !== 'string') return null;
  if (content.encoding === 'base64') {
    try {
      return Buffer.from(content.text, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  return content.text;
}

function getBodyText(entry, kind) {
  if (kind === 'request') {
    const request = entry?.request;
    return typeof request?.postData?.text === 'string' ? request.postData.text : null;
  }

  const content = entry?.response?.content;
  return decodeResponseText(content);
}

function parseMaybeJson(text) {
  if (typeof text !== 'string') return { isJson: false, value: text };
  const trimmed = text.trim();
  if (!trimmed) return { isJson: false, value: text };

  if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
    return { isJson: false, value: text };
  }

  try {
    return { isJson: true, value: JSON.parse(trimmed) };
  } catch {
    return { isJson: false, value: text };
  }
}

function detectProvider(url, parsedBody) {
  if (parsedBody && typeof parsedBody === 'object') {
    try {
      return resolveAdapter(url, parsedBody).id;
    } catch {
      // Fall through to URL-based hints.
    }
  }

  if (PROVIDER_HINTS.chatgpt.test(url)) return 'chatgpt';
  if (PROVIDER_HINTS.claude.test(url)) return 'claude';
  if (PROVIDER_HINTS.gemini.test(url)) return 'gemini';
  return 'generic';
}

function collectCandidates(entries, kind, provider) {
  return entries.filter((entry) => {
    const method = String(entry?.request?.method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH'].includes(method)) return false;

    const bodyText = getBodyText(entry, kind);
    if (typeof bodyText !== 'string' || bodyText.length === 0) return false;

    if (provider === 'auto') return true;

    const url = String(entry?.request?.url || '');
    const hint = PROVIDER_HINTS[provider] || PROVIDER_HINTS.generic;
    return hint.test(url);
  });
}

function toOutputPath(args) {
  if (args.out) {
    return path.isAbsolute(args.out) ? args.out : path.resolve(process.cwd(), args.out);
  }

  return path.resolve(
    process.cwd(),
    'tests',
    'fixtures',
    'captured',
    `${args.name}.${args.kind}.json`
  );
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(String(error.message || error));
    console.error('');
    console.error(usage());
    process.exit(1);
  }

  if (args.help) {
    console.log(usage());
    return;
  }

  const harPath = path.isAbsolute(args.har) ? args.har : path.resolve(process.cwd(), args.har);
  const har = readJson(harPath);
  const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];

  const candidates = collectCandidates(entries, args.kind, args.provider);
  if (candidates.length === 0) {
    throw new Error('No matching HAR entries with body text were found.');
  }

  if (args.index >= candidates.length) {
    throw new Error(`--index ${args.index} is out of range. Found ${candidates.length} candidate entries.`);
  }

  const entry = candidates[args.index];
  const bodyText = getBodyText(entry, args.kind);
  const parsed = parseMaybeJson(bodyText);
  const provider = args.provider === 'auto'
    ? detectProvider(entry?.request?.url || '', parsed.isJson ? parsed.value : null)
    : args.provider;

  const sanitized = sanitizeCapturedPayload(parsed.value, {
    seed: `capture:${args.name}:${provider}`,
    detectContextualNames: true
  });

  const fixture = {
    description: `Imported ${args.kind} capture for ${provider}`,
    provider,
    kind: args.kind,
    replacements: sanitized.replacements,
    source: {
      harFile: path.basename(harPath),
      candidateIndex: args.index,
      method: String(entry?.request?.method || 'POST').toUpperCase(),
      url: safeUrlWithoutQuery(entry?.request?.url || ''),
      importedAt: new Date().toISOString()
    },
    body: sanitized.value
  };

  if (args.kind === 'response') {
    fixture.source.status = Number(entry?.response?.status || 0);
  }

  const outputPath = toOutputPath(args);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

  console.log(`Wrote fixture: ${outputPath}`);
  console.log(`Provider: ${provider}`);
  console.log(`Replacements: ${sanitized.replacements}`);
  console.log(`Candidates scanned: ${candidates.length}`);
}

try {
  main();
} catch (error) {
  console.error(`Import failed: ${String(error.message || error)}`);
  process.exit(1);
}
