import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();

function runStep(command, args) {
  const label = `${command} ${args.join(' ')}`.trim();
  process.stdout.write(`\n[preflight] ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false
  });

  if (result.status !== 0) {
    throw new Error(`Step failed: ${label}`);
  }
}

function walkFiles(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Ignore output folder artifacts.
      if (entry.name === 'dist') continue;
      walkFiles(fullPath, out);
      continue;
    }

    out.push(fullPath);
  }

  return out;
}

function validateManifest() {
  const manifestPath = path.join(ROOT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (manifest.manifest_version !== 3) {
    throw new Error('manifest.json must use manifest_version 3');
  }

  if (!manifest.background || typeof manifest.background.service_worker !== 'string') {
    throw new Error('manifest.json missing background.service_worker');
  }

  if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length === 0) {
    throw new Error('manifest.json must define at least one content script');
  }

  process.stdout.write('[preflight] manifest validation passed\n');
}

function validateNoMacArtifacts() {
  const files = walkFiles(ROOT);
  const offenders = files.filter((file) => path.basename(file) === '.DS_Store');
  if (offenders.length > 0) {
    const shown = offenders.map((file) => path.relative(ROOT, file)).join(', ');
    process.stdout.write(`[preflight] warning: ignoring .DS_Store artifacts: ${shown}\n`);
    return;
  }

  process.stdout.write('[preflight] filesystem artifact check passed\n');
}

function main() {
  validateManifest();
  validateNoMacArtifacts();

  runStep('npm', ['test']);
  runStep('node', ['scripts/release/check-syntax.js']);
  runStep('node', ['scripts/compat/generate-matrix.js']);

  process.stdout.write('\n[preflight] all checks passed\n');
}

try {
  main();
} catch (error) {
  console.error(`\n[preflight] FAILED: ${error.message || String(error)}`);
  process.exit(1);
}
