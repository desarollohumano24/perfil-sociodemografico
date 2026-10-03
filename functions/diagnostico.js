/**
 * GET /diagnostico — revisa la configuración SIN mostrar ningún valor secreto.
 * Responde solo "sí/no" por variable y el resultado de una verificación de prueba de Turnstile.
 */
export async function onRequest(context) {
  const { env, request } = context;
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  if (request.method !== 'GET') return new Response('{}', { status: 405, headers });
  const site = String(env.TURNSTILE_SITE_KEY || '').trim();
  const secret = String(env.TURNSTILE_SECRET_KEY || '').trim();
  const flow = String(env.POWER_AUTOMATE_URL || '').trim();
  const out = {
    TURNSTILE_SITE_KEY_configurada: !!site,
    TURNSTILE_SECRET_KEY_configurada: !!secret,
    POWER_AUTOMATE_URL_configurada: !!flow,
    POWER_AUTOMATE_URL_empieza_por_https: /^https:\/\//i.test(flow),
    POWER_AUTOMATE_URL_tenia_espacios: String(env.POWER_AUTOMATE_URL || '') !== flow,
    POWER_AUTOMATE_URL_es_powerplatform: /\.powerplatform\.com|\.logic\.azure\.com/i.test(flow),
    POWER_AUTOMATE_URL_tiene_firma_sig: /[?&]sig=/.test(flow),
  };
  if (secret) {
    try {
      const form = new URLSearchParams({ secret, response: 'prueba-diagnostico' });
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
      const j = await r.json();
      const codes = Array.isArray(j['error-codes']) ? j['error-codes'] : [];
      out.turnstile_servicio_responde = r.ok;
      out.turnstile_clave_secreta_valida = !codes.includes('invalid-input-secret');
      out.turnstile_codigos = codes;
    } catch (_) {
      out.turnstile_servicio_responde = false;
    }
  }
  return new Response(JSON.stringify(out, null, 2), { status: 200, headers });
}
