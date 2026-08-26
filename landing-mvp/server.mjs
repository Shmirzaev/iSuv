import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const safe = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
    const path = join(root, safe);
    if (!path.startsWith(root)) throw new Error('Invalid path');
    const fileStat = await stat(path);
    if (!fileStat.isFile()) throw new Error('Not a file');
    const content = await readFile(path);
    response.writeHead(200, {
      'content-type': mime[extname(path)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    response.end(content);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`iSuv landing MVP: http://localhost:${port}`);
});
