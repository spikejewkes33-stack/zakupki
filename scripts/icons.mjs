// Рисует значки приложения (PNG) без внешних программ: синий фон, белый лист описи с тремя строками.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../site/icons/', import.meta.url));
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x / size, y / size), y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const BG = [29, 78, 216, 255];
const WHITE = [255, 255, 255, 255];
const LINE = [29, 78, 216, 255];
const ACC = [245, 158, 11, 255];
function pixel(u, v) {
  const inSheet = u > 0.27 && u < 0.73 && v > 0.2 && v < 0.8;
  if (!inSheet) return BG;
  const rows = [0.34, 0.47, 0.6];
  for (const r of rows) {
    if (v > r && v < r + 0.05) {
      if (u > 0.34 && u < 0.39) return ACC;
      if (u > 0.43 && u < 0.66) return LINE;
    }
  }
  return WHITE;
}
for (const s of [180, 192, 512]) writeFileSync(`${out}icon-${s}.png`, png(s, pixel));
console.log('icons: 180, 192, 512');
