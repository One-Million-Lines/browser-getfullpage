// Generates brand PNG icons (no external deps): a rounded indigo square with a
// white page frame and a downward arrow, evoking "capture the whole page below
// the fold". Encodes PNG in pure Node.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public/icons');

const INDIGO = [79, 70, 229]; // #4f46e5
const WHITE = [255, 255, 255];

function makeIcon(size) {
  const buf = new Uint8Array(size * size * 4); // RGBA, transparent
  const radius = size * 0.22;

  const setPx = (x, y, [cr, cg, cb], a = 255) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = cr;
    buf[i + 1] = cg;
    buf[i + 2] = cb;
    buf[i + 3] = a;
  };

  const fillRect = (x0, y0, x1, y1, color) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++) {
      for (let x = Math.round(x0); x < Math.round(x1); x++) setPx(x, y, color);
    }
  };

  // Rounded-rectangle background.
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, radius), size - 1 - radius);
    const cy = Math.min(Math.max(y, radius), size - 1 - radius);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inRounded(x, y)) setPx(x, y, INDIGO, 255);
    }
  }

  // White page frame (outline) occupying the left/upper region.
  const px = size * 0.22;
  const pw = size * 0.40;
  const py = size * 0.20;
  const ph = size * 0.60;
  const stroke = Math.max(1.4, size * 0.05);
  // Outline.
  fillRect(px, py, px + pw, py + stroke, WHITE); // top
  fillRect(px, py + ph - stroke, px + pw, py + ph, WHITE); // bottom
  fillRect(px, py, px + stroke, py + ph, WHITE); // left
  fillRect(px + pw - stroke, py, px + pw, py + ph, WHITE); // right
  // Fold line (represents the fold; content continues below).
  const foldY = py + ph * 0.42;
  fillRect(px + stroke, foldY, px + pw - stroke, foldY + stroke * 0.8, WHITE);

  // Downward arrow on the right, showing capture extends below the fold.
  const ax = size * 0.72;
  const aTop = size * 0.24;
  const aBottom = size * 0.68;
  const shaft = Math.max(1.4, size * 0.055);
  fillRect(ax - shaft / 2, aTop, ax + shaft / 2, aBottom, WHITE);
  // Arrowhead.
  const headR = size * 0.13;
  for (let t = 0; t < headR; t += 0.5) {
    const half = (headR - t) * 0.9;
    for (let s = -half; s <= half; s += 0.5) {
      setPx(ax + s, aBottom + t, WHITE);
    }
  }

  return buf;
}

/* ----------------------------- PNG encoder ----------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = encodePng(size, makeIcon(size));
  writeFileSync(resolve(OUT, `icon-${size}.png`), png);
  console.log(`icons/icon-${size}.png (${png.length} bytes)`);
}
console.log('Icons generated.');
