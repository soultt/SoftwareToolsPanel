'use strict';

/**
 * 生成应用图标：build/icon.png (256) + build/icon.ico
 * 纯 Node 实现，不依赖任何图形库。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 绘制 ---------- */
const SIZE = 256;

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

// 圆角矩形 SDF：<0 在内部
function roundRectSDF(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

const C1 = [0x6c, 0x8c, 0xff];
const C2 = [0xa6, 0x78, 0xff];

// 四个正方形块（左上、右上、左下）+ 右下圆点
const blocks = [
  { x: 84, y: 84, s: 44, a: 1 },
  { x: 172, y: 84, s: 44, a: 0.62 },
  { x: 84, y: 172, s: 44, a: 0.62 },
  { x: 172, y: 172, s: 44, a: 1, circle: true }
];

function sample(x, y) {
  // 返回 [r,g,b,a]（a 0..1）
  const body = roundRectSDF(x, y, 128, 128, 120, 120, 56);
  if (body > 0) return null;

  const t = Math.min(1, Math.max(0, (x / SIZE) * 0.55 + (y / SIZE) * 0.65));
  let color = mix(C1, C2, t);

  // 顶部高光
  const gloss = Math.max(0, 1 - y / 128) * 0.16;
  color = mix(color, [255, 255, 255], gloss);

  // 图形
  for (const b of blocks) {
    const half = b.s / 2;
    const d = b.circle
      ? Math.hypot(x - b.x, y - b.y) - half
      : roundRectSDF(x, y, b.x, b.y, half, half, 13);
    if (d < 0) {
      const white = mix(color, [255, 255, 255], b.a);
      return white;
    }
    if (d < 1.4) {
      const k = 1 - d / 1.4;
      return mix(color, [255, 255, 255], b.a * k);
    }
  }
  return color;
}

function render() {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const SS = 3;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 1;
          }
        }
      }
      const total = SS * SS;
      const idx = (y * SIZE + x) * 4;
      if (a > 0) {
        px[idx] = Math.round(r / a);
        px[idx + 1] = Math.round(g / a);
        px[idx + 2] = Math.round(b / a);
        px[idx + 3] = Math.round((a / total) * 255);
      }
    }
  }
  return encodePNG(SIZE, SIZE, px);
}

function encodeICO(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = 0; // 256 -> 0
  entry[1] = 0;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, png]);
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const png = render();
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeICO(png));
console.log('图标已生成:', path.join(outDir, 'icon.png'), path.join(outDir, 'icon.ico'));
