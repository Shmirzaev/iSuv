import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  const localUserId = process.env.ISUV_WEB_LOCAL_USER_ID;
  return {
    plugins: [react()],
    server: {
      proxy: {
        // Local development only: the browser keeps the same origin while the
        // API identity boundary remains server-authoritative. The optional
        // server-side header demonstrates a seeded role without bundling it.
        '/api': {
          target: process.env.VITE_API_ORIGIN ?? 'http://127.0.0.1:3000',
          changeOrigin: true,
          ...(localUserId ? { headers: { 'x-isuv-user-id': localUserId } } : {}),
        },
      },
    },
  };
});
