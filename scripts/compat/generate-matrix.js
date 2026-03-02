import fs from 'node:fs';
import path from 'node:path';
import { SessionStore } from '../../background/session-store.js';
import { transformOutgoingRequest } from '../../background/transform-engine.js';
import { rehydrateSegmentedText } from '../../shared/text-replacer.js';
import { installLocalLlmFetchMock } from '../../tests/helpers/local-llm-fetch-mock.js';

const ROOT = process.cwd();
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures');
const RESPONSE_FIXTURE_DIR = path.join(FIXTURE_DIR, 'responses');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'COMPATIBILITY_MATRIX.md');

const SETTINGS = {
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
  maxSessions: 200,
  maxMappingsPerSession: 400,
  debug: false
};

const REQUEST_CASES = [
  {
    fixture: 'chatgpt.request.json',
    provider: 'ChatGPT',
    url: 'https://chatgpt.com/backend-api/conversation',
    expectedAdapter: 'chatgpt'
  },
  {
    fixture: 'chatgpt.multimodal.request.json',
    provider: 'ChatGPT',
    url: 'https://chatgpt.com/backend-api/conversation',
    expectedAdapter: 'chatgpt'
  },
  {
    fixture: 'claude.request.json',
    provider: 'Claude',
    url: 'https://claude.ai/api/organizations/x/chat_conversations/y/completion',
    expectedAdapter: 'claude'
  },
  {
    fixture: 'claude.tooluse.request.json',
    provider: 'Claude',
    url: 'https://claude.ai/api/organizations/x/chat_conversations/y/completion',
    expectedAdapter: 'claude'
  },
  {
    fixture: 'gemini.request.json',
    provider: 'Gemini',
    url: 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate',
    expectedAdapter: 'gemini'
  },
  {
    fixture: 'gemini.nested.request.json',
    provider: 'Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
    expectedAdapter: 'gemini'
  },
  {
    fixture: 'generic.request.json',
    provider: 'Generic',
    url: 'https://unknown-ai.example.com/v1/messages',
    expectedAdapter: 'generic'
  },
  {
    fixture: 'generic.toolcall.request.json',
    provider: 'Generic',
    url: 'https://unknown-ai.example.com/v2/chat',
    expectedAdapter: 'generic'
  }
];

const RESPONSE_CASES = [
  'chatgpt.stream.segmented.json',
  'claude-long-stream.json',
  'multi-token-overlap.json'
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function runRequestCases() {
  const rows = [];
  const failures = [];

  for (let i = 0; i < REQUEST_CASES.length; i += 1) {
    const testCase = REQUEST_CASES[i];
    const payload = readJson(path.join(FIXTURE_DIR, testCase.fixture));
    const store = new SessionStore(SETTINGS);

    const result = await transformOutgoingRequest(
      {
        url: testCase.url,
        method: 'POST',
        bodyText: JSON.stringify(payload),
        origin: new URL(testCase.url).origin,
        tabId: i + 1
      },
      SETTINGS,
      store
    );

    const pass =
      result.action === 'allow' &&
      result.adapterId === testCase.expectedAdapter &&
      result.changed === true &&
      Number(result.replacements) > 0;

    if (!pass) {
      failures.push({
        fixture: testCase.fixture,
        expectedAdapter: testCase.expectedAdapter,
        gotAdapter: result.adapterId,
        action: result.action,
        changed: result.changed,
        replacements: result.replacements
      });
    }

    rows.push({
      provider: testCase.provider,
      fixture: testCase.fixture,
      adapterId: result.adapterId || 'n/a',
      changed: result.changed ? 'Yes' : 'No',
      replacements: Number(result.replacements || 0),
      pass: pass ? 'Yes' : 'No'
    });
  }

  return { rows, failures };
}

function runResponseCases() {
  const rows = [];
  const failures = [];

  for (const fixture of RESPONSE_CASES) {
    const payload = readJson(path.join(RESPONSE_FIXTURE_DIR, fixture));
    const result = rehydrateSegmentedText(payload.segments, payload.map);
    const output = result.segments.join('');

    const pass = result.changed === true && output === payload.expected;
    if (!pass) {
      failures.push({
        fixture,
        changed: result.changed,
        count: result.count,
        expected: payload.expected,
        output
      });
    }

    rows.push({
      fixture,
      segments: Array.isArray(payload.segments) ? payload.segments.length : 0,
      replacements: result.count,
      pass: pass ? 'Yes' : 'No'
    });
  }

  return { rows, failures };
}

function buildMarkdown(requestRows, responseRows) {
  const requestTable = requestRows
    .map((row) => `| ${row.provider} | ${row.fixture} | ${row.adapterId} | ${row.changed} | ${row.replacements} | ${row.pass} |`)
    .join('\n');

  const responseTable = responseRows
    .map((row) => `| ${row.fixture} | ${row.segments} | ${row.replacements} | ${row.pass} |`)
    .join('\n');

  return [
    '# Compatibility Matrix',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Request Adapter Coverage',
    '',
    '| Provider | Fixture | Adapter | Changed | Replacements | Pass |',
    '| --- | --- | --- | --- | ---: | --- |',
    requestTable,
    '',
    '## Response Rehydration Coverage',
    '',
    '| Fixture | Segments | Replacements | Pass |',
    '| --- | ---: | ---: | --- |',
    responseTable,
    ''
  ].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const restoreFetch = installLocalLlmFetchMock();

  try {
    const request = await runRequestCases();
    const response = runResponseCases();
    const markdown = buildMarkdown(request.rows, response.rows);

    if (write) {
      fs.writeFileSync(OUTPUT_PATH, markdown, 'utf8');
      console.log(`Wrote ${OUTPUT_PATH}`);
    } else {
      console.log(markdown);
    }

    const failures = [...request.failures, ...response.failures];
    if (failures.length > 0) {
      console.error('Compatibility matrix checks failed:');
      for (const failure of failures) {
        console.error(JSON.stringify(failure));
      }
      process.exit(1);
    }

    console.log('Compatibility matrix checks passed.');
  } finally {
    restoreFetch();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
