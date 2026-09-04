import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function safeAssetPath(root: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const candidate = resolve(root, decoded.replace(/^[/\\]+/, ''));
  const normalizedRoot = resolve(root);
  return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}${sep}`)
    ? candidate
    : null;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function registerWebAssets(app: FastifyInstance, root: string): void {
  const indexPath = resolve(root, 'index.html');

  app.get('/*', async (request, reply) => {
    const requestPath = new URL(request.url, 'http://isuv.invalid').pathname;
    if (
      requestPath === '/api' ||
      requestPath.startsWith('/api/') ||
      requestPath === '/health' ||
      requestPath.startsWith('/health/') ||
      requestPath === '/metrics' ||
      requestPath.startsWith('/metrics/')
    ) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const requested = safeAssetPath(root, requestPath);
    const filePath = requested && (await isFile(requested)) ? requested : indexPath;
    if (!(await isFile(filePath))) return reply.code(503).send('Web application is unavailable.');

    const extension = extname(filePath).toLowerCase();
    reply.type(contentTypes[extension] ?? 'application/octet-stream');
    reply.header(
      'cache-control',
      filePath === indexPath ? 'no-cache' : 'public, max-age=31536000, immutable',
    );
    return reply.send(createReadStream(filePath));
  });
}
