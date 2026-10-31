// Cloudflare Pages Functions: forward API and health requests to the API service
// so the browser keeps one origin. The public demo API is read-only and resolves
// its own fixed identity, so client-supplied identity headers are never forwarded.
export async function proxyToApi(context) {
  const origin = context.env.ISUV_API_ORIGIN;
  if (!origin) return new Response('API origin is not configured.', { status: 503 });
  const incoming = new URL(context.request.url);
  const target = new URL(incoming.pathname + incoming.search, origin);
  const headers = new Headers(context.request.headers);
  headers.delete('x-isuv-user-id');
  headers.delete('host');
  headers.set('x-forwarded-host', incoming.host);
  const method = context.request.method;
  return fetch(target, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : context.request.body,
    redirect: 'manual',
  });
}
