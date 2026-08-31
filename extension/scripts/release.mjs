/**
 * Release helper:
 *   npm run release -- patch    # bump patch (1.0.0 → 1.0.1)
 *   npm run release -- minor    # bump minor (1.0.0 → 1.1.0)
 *   npm run release -- major    # bump major (1.0.0 → 2.0.0)
 *   npm run release -- 1.2.3    # set exact version
 *
 * Bumps: package.json, package-lock.json, and the version constant in source.
 * Then runs build:all to produce release-ready artifacts.
 */
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const packageJsonPath = resolve(root, 'package.json');
const packageLockPath = resolve(root, 'package-lock.json');
const versionFilePath = resolve(root, 'src/config/product.ts');
const VERSION_CONST = 'RELEASE_VERSION';

const arg = process.argv[2];

if (!arg) {
  console.error(
    'Usage: npm run release -- <patch|minor|major|x.y.z>\n' +
    'Example: npm run release -- patch',
  );
  process.exit(1);
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function parseVersion(text) {
  if (!SEMVER_RE.test(text)) throw new Error(`Invalid semver: ${text}`);
  const [major, minor, patch] = text.split('.').map(Number);
  return { major, minor, patch };
}

function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function nextVersion(current, mode) {
  const v = parseVersion(current);
  if (mode === 'patch') return formatVersion({ ...v, patch: v.patch + 1 });
  if (mode === 'minor') return formatVersion({ major: v.major, minor: v.minor + 1, patch: 0 });
  if (mode === 'major') return formatVersion({ major: v.major + 1, minor: 0, patch: 0 });
  if (SEMVER_RE.test(mode)) return mode;
  throw new Error(`Unsupported bump mode: ${mode}`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const pkg = await readJson(packageJsonPath);
  const current = pkg.version;
  const target = nextVersion(current, arg);

  if (current !== target) {
    pkg.version = target;
    await writeFile(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');

    try {
      const lock = await readJson(packageLockPath);
      lock.version = target;
      if (lock.packages?.['']) lock.packages[''].version = target;
      await writeFile(packageLockPath, JSON.stringify(lock, null, 2) + '\n');
    } catch {
      // Ignore if package-lock.json is absent.
    }

    const src = await readFile(versionFilePath, 'utf8');
    const updated = src.replace(
      new RegExp(`(export const ${VERSION_CONST}\\s*=\\s*['\"])([^'\"]+)(['\"])`),
      `$1${target}$3`,
    );
    if (updated === src) throw new Error(`Could not find ${VERSION_CONST} in ${versionFilePath}`);
    await writeFile(versionFilePath, updated);

    console.log(`Bumped: ${current} → ${target}`);
  } else {
    console.log(`Already at ${target}; building…`);
  }

  await run('npm', ['run', 'build:all'], { cwd: root });
  console.log(`\n✅ Release ready: v${target}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
