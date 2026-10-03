/**
 * Cloudflare Pages Function — GET /api/config
 *
 * Entrega al formulario la Site Key PÚBLICA de Turnstile (no es un secreto: Cloudflare
 * la diseñó para estar en el navegador). Así no hay que editar el código para configurarla.
 *
 * Variable (texto, no secreta) en Cloudflare:
 *   TURNSTILE_SITE_KEY = [CONFIGURAR EN CLOUDFLARE]
 */
export async function onRequest(context) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  };
  if (context.request.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false }), { status: 405, headers: { ...headers, Allow: 'GET' } });
  }
  const siteKey = context.env.TURNSTILE_SITE_KEY || '';
  return new Response(JSON.stringify({ siteKey }), { status: siteKey ? 200 : 503, headers });
}
