import * as esbuild from 'esbuild';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src');
const ALIAS = { '@': SRC };

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const getArg = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : undefined;
};

const OUT_DIR = {
  chrome: 'dist',
  firefox: 'dist-firefox',
  safari: 'dist-safari',
};

/* --------------------------- load TS build config --------------------------- */

async function loadConfig() {
  const res = await esbuild.build({
    entryPoints: [resolve(SRC, 'config/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    alias: ALIAS,
    logLevel: 'silent',
  });
  const code = res.outputFiles[0].text;
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(url);
}

/* ------------------------------- build passes ------------------------------- */

/** Entries bundled as self-contained IIFE (no remote/dynamic imports). */
function entryPoints(dist) {
  return [
    { in: resolve(SRC, 'background/service-worker.ts'), out: resolve(dist, 'service-worker.js') },
    { in: resolve(SRC, 'content/content-entry.ts'), out: resolve(dist, 'content.js') },
    { in: resolve(SRC, 'offscreen/offscreen-entry.ts'), out: resolve(dist, 'offscreen.js') },
    { in: resolve(SRC, 'preview/preview-entry.ts'), out: resolve(dist, 'preview/preview.js') },
    { in: resolve(SRC, 'options/options-entry.ts'), out: resolve(dist, 'options/options.js') },
  ];
}

async function buildBundles(dist, watch) {
  const contexts = [];
  for (const entry of entryPoints(dist)) {
    const options = {
      entryPoints: [entry.in],
      outfile: entry.out,
      bundle: true,
      format: 'iife',
      target: 'es2022',
      minify: !watch,
      sourcemap: watch,
      legalComments: 'none',
      alias: ALIAS,
      logLevel: 'warning',
      define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
    };
    if (watch) {
      const ctx = await esbuild.context(options);
      await ctx.watch();
      contexts.push(ctx);
    } else {
      await esbuild.build(options);
    }
  }
  return contexts;
}

/* --------------------------------- helpers --------------------------------- */

function copyDir(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

function copyFile(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}

function walk(dir, base = dir, out = {}) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out[relative(base, full)] = new Uint8Array(readFileSync(full));
  }
  return out;
}

function zipDir(dir, name) {
  const files = walk(dir);
  const zipped = zipSync(files, { level: 6 });
  const zipRoot = resolve(ROOT, 'dist-zip');
  mkdirSync(zipRoot, { recursive: true });
  const out = resolve(zipRoot, `${name}.zip`);
  writeFileSync(out, zipped);
  console.log(`  ⇢ packaged ${relative(ROOT, out)} (${(zipped.length / 1024).toFixed(0)} KB)`);
}

/* ---------------------------------- main ----------------------------------- */

async function main() {
  const config = await loadConfig();
  const target = getArg('target') ?? 'chrome';
  const watch = has('watch');
  const dist = resolve(ROOT, OUT_DIR[target] ?? 'dist');

  if (!OUT_DIR[target]) {
    console.error(`Unknown target "${target}". Use chrome | firefox | safari.`);
    process.exit(1);
  }

  console.log(`\n▶ Building GetFullPage v${config.RELEASE_VERSION} (${target}) → ${relative(ROOT, dist)}/`);

  if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  const contexts = await buildBundles(dist, watch);

  // Static HTML/CSS pages (CSP: script-src 'self').
  copyFile(resolve(SRC, 'offscreen/offscreen.html'), resolve(dist, 'offscreen.html'));
  copyFile(resolve(SRC, 'preview/preview.html'), resolve(dist, 'preview/preview.html'));
  copyFile(resolve(SRC, 'preview/preview.css'), resolve(dist, 'preview/preview.css'));
  copyFile(resolve(SRC, 'options/options.html'), resolve(dist, 'options/options.html'));
  copyFile(resolve(SRC, 'options/options.css'), resolve(dist, 'options/options.css'));

  // Manifest (generated from typed config, never hand-edited).
  const manifest = config.buildManifest(target);
  writeFileSync(resolve(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Icons.
  copyDir(resolve(ROOT, 'public/icons'), resolve(dist, 'icons'));

  // Permission audit report.
  const report = config.manifestReport(target);
  writeFileSync(resolve(dist, 'build-report.json'), JSON.stringify(report, null, 2));

  console.log(`  ✓ ${manifest.name} v${manifest.version}`);
  console.log(`    required permissions: ${report.permissions.join(', ')}`);
  console.log(`    optional permissions: ${report.optionalPermissions.join(', ') || '(none)'}`);
  console.log(`    host permissions:     ${report.hostPermissions.join(', ') || '(none)'}`);

  if (has('zip')) zipDir(dist, `getfullpage-${target}-${config.RELEASE_VERSION}`);

  if (watch) {
    console.log('\n👀 Watching for changes… (Ctrl+C to stop)');
    // Keep process alive; esbuild contexts are watching.
    await new Promise(() => {});
    void contexts;
  } else {
    console.log(`\n✅ Done. Load the unpacked extension from ${relative(ROOT, dist)}/`);
  }
}

main().catch((e) => {
  console.error('\n❌ Build failed:', e);
  process.exit(1);
});
