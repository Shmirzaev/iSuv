import { createApp } from './app.js';
import { fileURLToPath } from 'node:url';
import { registerWebAssets } from './web-assets.js';

const host = process.env.API_HOST ?? (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const port = Number(process.env.PORT ?? process.env.API_PORT ?? '3000');
const app = createApp();

if (process.env.ISUV_SERVE_WEB === 'true') {
  const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  registerWebAssets(app, webRoot);
}

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error({ err: error }, 'API failed to start');
  process.exitCode = 1;
}
