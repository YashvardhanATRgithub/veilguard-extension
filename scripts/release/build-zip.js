import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist');
const RELEASE_MANIFEST = path.join(DIST_DIR, 'release-manifest.json');
const INCLUDE_PATHS = [
  'manifest.json',
  'background',
  'content',
  'page',
  'shared',
  'popup',
  'options',
  'rules'
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function sha256OfFile(filePath) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function walkFiles(dir, relBase = '', out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.join(relBase, entry.name);

    if (entry.isDirectory()) {
      walkFiles(fullPath, relPath, out);
      continue;
    }

    if (entry.isFile()) {
      out.push({ fullPath, relPath: relPath.replace(/\\/g, '/') });
    }
  }
  return out;
}

function removeMacArtifacts(dir) {
  const files = walkFiles(dir);
  for (const file of files) {
    if (path.basename(file.fullPath) === '.DS_Store') {
      fs.unlinkSync(file.fullPath);
    }
  }
}

function createStage(version) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), `veilguard-${version}-`));
  for (const rel of INCLUDE_PATHS) {
    const src = path.join(ROOT, rel);
    const dest = path.join(stage, rel);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing required release path: ${rel}`);
    }
    fs.cpSync(src, dest, { recursive: true });
  }
  removeMacArtifacts(stage);
  return stage;
}

function writeReleaseManifest(version, zipPath, stageDir) {
  const files = walkFiles(stageDir).map((entry) => ({
    path: entry.relPath,
    bytes: fs.statSync(entry.fullPath).size,
    sha256: sha256OfFile(entry.fullPath)
  }));

  const payload = {
    schemaVersion: 1,
    builtAt: new Date().toISOString(),
    version,
    artifact: path.basename(zipPath),
    artifactSha256: sha256OfFile(zipPath),
    artifactBytes: fs.statSync(zipPath).size,
    fileCount: files.length,
    files
  };

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(RELEASE_MANIFEST, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function getVersion() {
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return String(pkg.version || '0.0.0');
}

function main() {
  const args = process.argv.slice(2);
  const skipPreflight = args.includes('--skip-preflight');

  if (!skipPreflight) {
    run('node', ['scripts/release/preflight.js']);
  }

  run('node', ['scripts/compat/generate-matrix.js', '--write']);

  const version = getVersion();
  const zipName = `veilguard-extension-v${version}.zip`;
  const zipPath = path.join(DIST_DIR, zipName);
  const stageDir = createStage(version);

  fs.mkdirSync(DIST_DIR, { recursive: true });
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  try {
    run('tar', ['-a', '-cf', zipPath, '-C', stageDir, '.']);
    writeReleaseManifest(version, zipPath, stageDir);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }

  console.log(`Built artifact: ${zipPath}`);
  console.log(`Release manifest: ${RELEASE_MANIFEST}`);
}

try {
  main();
} catch (error) {
  console.error(`Release build failed: ${error.message || String(error)}`);
  process.exit(1);
}
