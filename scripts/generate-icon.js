#!/usr/bin/env node
/**
 * 生成市场图标 images/icon.png（256x256，无第三方依赖）。
 * 图案：放大镜，镜片内红色横条表示写入、绿色横条表示读取。
 * 用法：node scripts/generate-icon.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const SAMPLES = 4;

const BG = [30, 58, 95];
const WHITE = [255, 255, 255];
const WRITE = [226, 75, 74];
const READ = [93, 202, 165];

function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function insideRing(x, y, cx, cy, rIn, rOut) {
  const d = (x - cx) ** 2 + (y - cy) ** 2;
  return d >= rIn * rIn && d <= rOut * rOut;
}

function insideCapsule(x, y, ax, ay, bx, by, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  const px = ax + t * dx;
  const py = ay + t * dy;
  return (x - px) ** 2 + (y - py) ** 2 <= r * r;
}

const layers = [
  { color: BG, hit: (x, y) => insideRoundRect(x, y, 0, 0, SIZE, SIZE, 52) },
  { color: WHITE, hit: (x, y) => insideRing(x, y, 110, 110, 58, 76) },
  { color: WHITE, hit: (x, y) => insideCapsule(x, y, 166, 166, 214, 214, 14) },
  { color: WRITE, hit: (x, y) => insideRoundRect(x, y, 74, 86, 146, 104, 9) },
  { color: READ, hit: (x, y) => insideRoundRect(x, y, 74, 118, 130, 136, 9) },
];

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1);
  raw[row] = 0;
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const px = x + (sx + 0.5) / SAMPLES;
        const py = y + (sy + 0.5) / SAMPLES;
        let color;
        for (const layer of layers) {
          if (layer.hit(px, py)) {
            color = layer.color;
          }
        }
        if (color) {
          r += color[0];
          g += color[1];
          b += color[2];
          a += 255;
        }
      }
    }
    const n = SAMPLES * SAMPLES;
    const covered = a / 255;
    const offset = row + 1 + x * 4;
    raw[offset] = covered ? Math.round(r / covered) : 0;
    raw[offset + 1] = covered ? Math.round(g / covered) : 0;
    raw[offset + 2] = covered ? Math.round(b / covered) : 0;
    raw[offset + 3] = Math.round(a / n);
  }
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8;
header[9] = 6;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'images', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`已生成 ${out}（${png.length} 字节）`);
