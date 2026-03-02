import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const INCLUDE_DIRS = [
  'background',
  'content',
  'page',
  'shared',
  'popup',
  'options',
  'scripts',
  'tests'
];

function collectJsFiles(dir, out = []) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return out;

  const entries = fs.readdirSync(full, { withFileTypes: true });
  for (const entry of entries) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(rel, out);
      continue;
    }

    if (entry.isFile() && rel.endsWith('.js')) {
      out.push(rel);
    }
  }
  return out;
}

function main() {
  const files = INCLUDE_DIRS.flatMap((dir) => collectJsFiles(dir));
  let checked = 0;

  for (const file of files) {
    const result = spawnSync('node', ['--check', file], {
      cwd: ROOT,
      stdio: 'inherit'
    });
    if (result.status !== 0) {
      console.error(`Syntax check failed: ${file}`);
      process.exit(result.status || 1);
    }
    checked += 1;
  }

  console.log(`Syntax check passed for ${checked} files.`);
}

main();
