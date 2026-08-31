/**
 * End-to-end capture test. Loads the built extension in real Chromium, captures
 * a deterministic tall fixture with a fixed header, and verifies the stitched
 * image: correct dimensions, correct colour bands at the top and bottom, and
 * that the fixed header is de-duplicated (not repeated at slice boundaries).
 *
 * A test-only manifest variant adds host_permissions so capture can be triggered
 * from an automated message instead of a real toolbar click (which grants
 * activeTab in normal use). The shipped manifest keeps the minimal permission set.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const DIST = resolve(ROOT, 'dist');
const DIST_E2E = resolve(ROOT, 'dist-e2e');
const FIXTURES = resolve(ROOT, 'tests/fixtures');

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };

function log(ok, msg) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`);
  if (!ok) process.exitCode = 1;
}

function near(actual, expected, tol) {
  return Math.abs(actual - expected) <= tol;
}
function colorNear(c, [r, g, b], tol = 45) {
  return near(c[0], r, tol) && near(c[1], g, tol) && near(c[2], b, tol);
}

function prepareE2EBuild() {
  if (!existsSync(DIST)) throw new Error('dist/ not found — run `npm run build` first.');
  rmSync(DIST_E2E, { recursive: true, force: true });
  cpSync(DIST, DIST_E2E, { recursive: true });
  const manifestPath = join(DIST_E2E, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  // Grant host permissions so message-triggered capture is authorised in tests,
  // and the debugger permission so mobile emulation can attach without a prompt.
  manifest.host_permissions = ['<all_urls>'];
  manifest.permissions = [...new Set([...manifest.permissions, 'debugger'])];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = join(FIXTURES, urlPath === '/' ? 'index.html' : urlPath);
    if (!filePath.startsWith(FIXTURES) || !existsSync(filePath)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(readFileSync(filePath));
  });
  return new Promise((resolveFn) => server.listen(0, '127.0.0.1', () => resolveFn(server)));
}

async function main() {
  prepareE2EBuild();
  const server = await startServer();
  const port = server.address().port;
  const fixtureUrl = `http://127.0.0.1:${port}/e2e.html`;

  const userDataDir = resolve(ROOT, '.e2e-profile');
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });

  const externalRequests = [];
  const consoleErrors = [];

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    args: [
      '--headless=new',
      `--disable-extensions-except=${DIST_E2E}`,
      `--load-extension=${DIST_E2E}`,
      '--no-first-run',
      '--disable-background-timer-throttling',
    ],
  });

  context.on('request', (req) => {
    const u = req.url();
    if (
      u.startsWith('http://127.0.0.1') ||
      u.startsWith('chrome-extension://') ||
      u.startsWith('blob:') ||
      u.startsWith('data:') ||
      u.startsWith('about:')
    ) {
      return;
    }
    // Only attribute external requests that originate from one of our own
    // extension pages/content — Chrome's own startup telemetry is browser-level
    // (no owning frame) and is not the extension's doing.
    const frame = req.frame();
    const frameUrl = frame ? frame.url() : '';
    if (frameUrl.startsWith('chrome-extension://') || frameUrl.startsWith('http://127.0.0.1')) {
      externalRequests.push(`${u} (from ${frameUrl})`);
    }
  });

  const noteConsole = (label) => (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Ignore page resource 404s (e.g. favicon) — not JS errors from our code.
    if (text.includes('Failed to load resource')) return;
    consoleErrors.push(`${label}: ${text}`);
  };

  try {
    // Obtain the service worker + extension id.
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    log(Boolean(extId), `extension loaded (id ${extId})`);

    // Open the fixture page.
    const page = await context.newPage();
    page.on('console', noteConsole('fixture'));
    await page.goto(fixtureUrl, { waitUntil: 'load' });
    await page.waitForTimeout(300);

    // Find the fixture tab id via the service worker.
    const fixtureInfo = await sw.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url && t.url.startsWith(url));
      return tab ? { tabId: tab.id, windowId: tab.windowId } : null;
    }, fixtureUrl);
    log(Boolean(fixtureInfo), `found fixture tab (${JSON.stringify(fixtureInfo)})`);

    // Open the options page (an extension page) to relay the start message,
    // then re-activate the fixture tab so captureVisibleTab targets it.
    const relay = await context.newPage();
    relay.on('console', noteConsole('ext-page'));
    await relay.goto(`chrome-extension://${extId}/options/options.html`, { waitUntil: 'load' });

    await sw.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), fixtureInfo.tabId);
    await page.waitForTimeout(200);

    // Listen for the preview tab before triggering capture.
    const previewPromise = context.waitForEvent('page', {
      predicate: (p) => p.url().includes('/preview/preview.html'),
      timeout: 60000,
    });

    await relay.evaluate(
      ({ tabId }) => chrome.runtime.sendMessage({ type: 'CAPTURE_START', tabId, mode: 'full' }),
      { tabId: fixtureInfo.tabId },
    );

    const preview = await previewPromise;
    preview.on('console', noteConsole('preview'));
    log(true, 'preview tab opened');

    // Wait for the image to load and sample pixels.
    await preview.waitForSelector('#image', { timeout: 30000 });
    await preview.waitForFunction(
      () => {
        const img = document.getElementById('image');
        return img && img.complete && img.naturalWidth > 0;
      },
      { timeout: 30000 },
    );

    const sample = await preview.evaluate(async () => {
      const img = document.getElementById('image');
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const at = (x, y) => {
        const d = ctx.getImageData(x, y, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      const h = img.naturalHeight;
      return {
        w: img.naturalWidth,
        h,
        header: at(50, 12),
        green: at(50, 140),
        afterFirstSlice: at(50, 830),
        mid: at(50, Math.floor(h / 2)),
        threeQuarter: at(50, Math.floor(h * 0.75)),
        bottom: at(50, h - 12),
        errorHidden: document.getElementById('errorView').hidden,
      };
    });

    console.log('    sample:', JSON.stringify(sample));

    log(sample.errorHidden, 'preview shows the image (no error view)');
    log(near(sample.w, 1280, 8), `image width ~1280 (got ${sample.w})`);
    // Note: Playwright emulates the page viewport via DevTools while
    // captureVisibleTab uses the real window surface, so the physical height is a
    // scaled multiple of the viewport rather than an exact 4000. We assert the
    // result is clearly a tall, multi-viewport stitch that reaches the bottom.
    log(sample.h > 3000 && sample.h < 4300, `image is a tall multi-slice stitch (got ${sample.h})`);
    log(sample.h > sample.w * 2, `image height >> width, i.e. many slices (h=${sample.h})`);
    log(colorNear(sample.header, [220, 20, 60]), `fixed header captured at top (${sample.header})`);
    log(colorNear(sample.green, [0, 160, 60]), `green band below header (${sample.green})`);
    log(colorNear(sample.bottom, [20, 60, 220]), `blue band at bottom, page fully covered (${sample.bottom})`);

    // No gaps and no repeated fixed header anywhere below the first slice.
    log(colorNear(sample.afterFirstSlice, [255, 255, 255]), `no gap/header after slice 1 (${sample.afterFirstSlice})`);
    log(colorNear(sample.mid, [255, 255, 255]), `no gap/header at mid-page (${sample.mid})`);
    log(colorNear(sample.threeQuarter, [255, 255, 255]), `no gap/header at 75% (${sample.threeQuarter})`);

    // Verify the original page was restored (scroll position back to top).
    const restored = await page.evaluate(() => ({
      scrollY: window.scrollY,
      overlay: !document.getElementById('getfullpage-overlay-host'),
      headerVisible: getComputedStyle(document.getElementById('hdr')).visibility === 'visible',
    }));
    log(restored.scrollY === 0, `page scroll restored to top (got ${restored.scrollY})`);
    log(restored.overlay, 'capture overlay removed from page');
    log(restored.headerVisible, 'fixed header visibility restored on page');

    // Exercise the export pipeline end-to-end and validate file magic bytes.
    async function grabDownload(btnId) {
      const [download] = await Promise.all([
        preview.waitForEvent('download', { timeout: 25000 }),
        preview.click(`#${btnId}`),
      ]);
      const path = await download.path();
      return { bytes: readFileSync(path), name: download.suggestedFilename() };
    }
    const startsWith = (buf, sig) => sig.every((b, i) => buf[i] === b);

    try {
      const png = await grabDownload('btnPng');
      log(startsWith(png.bytes, [0x89, 0x50, 0x4e, 0x47]) && png.name.endsWith('.png'), `PNG export valid (${png.name}, ${png.bytes.length} bytes)`);

      const jpeg = await grabDownload('btnJpeg');
      log(startsWith(jpeg.bytes, [0xff, 0xd8, 0xff]) && jpeg.name.endsWith('.jpg'), `JPEG export valid (${jpeg.name}, ${jpeg.bytes.length} bytes)`);

      const pdf = await grabDownload('btnPdf');
      const pdfHead = String.fromCharCode(...pdf.bytes.slice(0, 5));
      const pdfTail = String.fromCharCode(...pdf.bytes.slice(-6));
      log(pdfHead === '%PDF-' && pdfTail.includes('EOF') && pdf.name.endsWith('.pdf'), `PDF export valid (${pdf.name}, ${pdf.bytes.length} bytes)`);
    } catch (e) {
      log(false, `export downloads failed: ${e.message}`);
    }

    log(externalRequests.length === 0, `zero external network requests (got ${externalRequests.length})`);
    if (externalRequests.length) console.log('    external:', externalRequests.join('\n      '));

    /* ----------------------------- mobile capture ----------------------------- */
    console.log('\n  — mobile emulation —');
    const responsiveUrl = `http://127.0.0.1:${port}/responsive.html`;
    const mpage = await context.newPage();
    mpage.on('console', noteConsole('m-fixture'));
    await mpage.goto(responsiveUrl, { waitUntil: 'load' });
    await mpage.waitForTimeout(300);

    // Confirm the page renders the DESKTOP layout (red) at the normal viewport.
    const desktopColor = await mpage.evaluate(() => {
      const d = document.querySelector('.box');
      return getComputedStyle(d).backgroundColor;
    });
    log(/220,\s*20,\s*60/.test(desktopColor), `responsive fixture is desktop (red) normally (${desktopColor})`);

    const minfo = await sw.evaluate(async (u) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url && t.url.startsWith(u));
      return tab ? { tabId: tab.id } : null;
    }, responsiveUrl);
    await sw.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), minfo.tabId);
    await mpage.waitForTimeout(200);

    const mPreviewPromise = context.waitForEvent('page', {
      predicate: (p) => p.url().includes('/preview/preview.html'),
      timeout: 60000,
    });
    await relay.evaluate(
      ({ tabId }) => chrome.runtime.sendMessage({ type: 'CAPTURE_START', tabId, mobile: true }),
      { tabId: minfo.tabId },
    );

    const mpreview = await mPreviewPromise;
    mpreview.on('console', noteConsole('m-preview'));
    await mpreview.waitForSelector('#image', { timeout: 30000 });
    await mpreview.waitForFunction(
      () => {
        const img = document.getElementById('image');
        return img && img.complete && img.naturalWidth > 0;
      },
      { timeout: 30000 },
    );
    const msample = await mpreview.evaluate(async () => {
      const img = document.getElementById('image');
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(40, 20, 1, 1).data;
      return {
        w: img.naturalWidth,
        h: img.naturalHeight,
        top: [d[0], d[1], d[2]],
        device: document.getElementById('metaDevice').textContent,
        errorHidden: document.getElementById('errorView').hidden,
      };
    });
    console.log('    mobile sample:', JSON.stringify(msample));

    log(msample.errorHidden, 'mobile preview shows the image');
    // iPhone 13 profile is 390 CSS px @ 3x → 1170 physical px wide.
    log(near(msample.w, 1170, 24), `mobile image width ~1170 (390@3x) got ${msample.w}`);
    log(msample.w < 1280, `mobile image narrower than desktop viewport (${msample.w} < 1280)`);
    log(colorNear(msample.top, [0, 160, 60]), `mobile media query applied (green layout) got ${msample.top}`);
    log(/iPhone|390/.test(msample.device || ''), `preview shows the device label (${msample.device})`);

    // The source tab must be restored to desktop after emulation detaches.
    await mpage.waitForTimeout(300);
    const innerWidth = await mpage.evaluate(() => window.innerWidth);
    log(innerWidth > 1000, `emulation cleared; source tab back to desktop width (${innerWidth})`);

    log(
      consoleErrors.length === 0,
      `no console errors${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`,
    );
  } finally {
    await context.close();
    server.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }

  if (process.exitCode) console.log('\n❌ E2E capture test FAILED');
  else console.log('\n✅ E2E capture test PASSED');
}

main().catch((e) => {
  console.error('E2E error:', e);
  process.exit(1);
});
