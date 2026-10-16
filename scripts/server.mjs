import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { build, root } from './build.mjs';
await build();
const base = resolve(root, 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm':'application/wasm' };
createServer(async (req, res) => {
  try {
    const path = resolve(base, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (path !== base && !path.startsWith(base + '/')) throw new Error('Invalid path');
    const file = path === base ? path + '/index.html' : path;
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT || 5173), '127.0.0.1', () => console.log('Local: http://127.0.0.1:' + (process.env.PORT || 5173)));
