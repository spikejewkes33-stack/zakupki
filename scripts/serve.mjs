// Простой локальный сервер для проверки на компьютере: http://localhost:5181
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../site/', import.meta.url));
const port = Number(process.env.PORT) || 5181;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

// Только для проверки на компьютере: страница может отправить готовый PDF/Excel сюда (PUT /__check/имя),
// файл ляжет в check-out/ и его можно открыть и проверить. На GitHub Pages этого нет.
const checkDir = fileURLToPath(new URL('../check-out/', import.meta.url));

createServer(async (req, res) => {
  if (req.method === 'PUT' && req.url.startsWith('/__check/')) {
    const name = basename(decodeURIComponent(req.url.slice(9)));
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await mkdir(checkDir, { recursive: true });
    await writeFile(join(checkDir, name), Buffer.concat(chunks));
    res.writeHead(200).end('ok');
    return;
  }
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
  const file = join(root, path === '.' || path === '' || /[\\/]$/.test(path) ? `${path}/index.html` : path);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`));
