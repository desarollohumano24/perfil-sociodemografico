/**
 * Cloudflare Pages Function — POST /api/enviar
 *
 * Intermediario entre el formulario y Power Automate:
 *   navegador → /api/enviar (esta función) → Power Automate → Excel
 *
 * SECRETOS (se configuran en Cloudflare, nunca en este código):
 *   POWER_AUTOMATE_URL   = [CONFIGURAR EN CLOUDFLARE COMO SECRET]
 *   TURNSTILE_SECRET_KEY = [CONFIGURAR EN CLOUDFLARE COMO SECRET]
 *
 * Esta función nunca devuelve, imprime ni registra la URL de Power Automate
 * ni los datos del formulario.
 */

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_ACTION = 'perfil';
// Claves de prueba oficiales de Cloudflare (no son secretos). Con ellas no se valida el hostname.
const TURNSTILE_TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

const MAX_BODY_BYTES = 64 * 1024;   // el envío normal pesa ~3 KB
const MAX_FIELD_CHARS = 1000;
const MAX_TOKEN_CHARS = 2048;
const POWER_AUTOMATE_TIMEOUT_MS = 30000;

// Control de solicitudes excesivas por IP (por instancia; complemento de Turnstile).
// Es generoso porque en la clínica muchas personas pueden salir por la misma IP del wifi.
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const rateBuckets = new Map();

// Estructura exacta que espera el flujo de Power Automate: "Fecha y hora" + Q1…Q57
const QUESTION_KEYS = Array.from({ length: 57 }, (_, i) => `Q${i + 1}`);
const ALLOWED_KEYS = new Set(['Fecha y hora', ...QUESTION_KEYS]);

// Mismas preguntas condicionales que el formulario: solo son obligatorias si se cumple la condición.
const multi = (v) => (v ? String(v).split(' | ') : []);
const CONDITIONS = {
  Q9: (d) => d.Q8 === 'Sí',
  Q10: (d) => d.Q8 === 'Sí',
  Q13: (d) => d.Q12 === 'Sí' && (d.Q5 === 'Mujer' || ['Mujer', 'Mujer trans'].includes(d.Q6)),
  Q16: (d) => d.Q15 === 'Sí',
  Q22: (d) => ['Motocicleta', 'Automóvil particular'].includes(d.Q21),
  Q33: (d) => d.Q32 === 'Sí',
  Q36: (d) => multi(d.Q35).includes('Persona con discapacidad'),
  Q37: (d) => multi(d.Q35).includes('Persona con discapacidad'),
  Q38: (d) => multi(d.Q35).includes('Persona con discapacidad'),
  Q39: (d) => multi(d.Q35).includes('Persona con discapacidad') && d.Q38 === 'Sí',
  Q44: (d) => d.Q43 === 'Sí',
  Q45: (d) => d.Q43 === 'Sí' && multi(d.Q44).includes('Otra'),
  Q46: (d) => d.Q43 === 'Sí',
  Q48: (d) => d.Q47 === 'Sí',
  Q49: (d) => d.Q47 === 'Sí' && multi(d.Q48).includes('Otro'),
  Q50: (d) => d.Q47 === 'Sí',
  Q51: (d) => d.Q47 === 'Sí',
  Q54: (d) => d.Q53 === 'Sí consumo',
};

const MSG = {
  ok: 'Información recibida correctamente.',
  validacion: 'Algunos datos no son válidos. Revisa el formulario e inténtalo nuevamente.',
  seguridad: 'No fue posible verificar el envío. Recarga la página e inténtalo nuevamente.',
  limite: 'Se recibieron demasiados envíos desde tu conexión. Espera unos minutos e inténtalo nuevamente.',
  temporal: 'No fue posible enviar la información en este momento. Inténtalo nuevamente en unos minutos.',
  metodo: 'Método no permitido.',
};

function respond(status, estado, mensaje, extraHeaders = {}) {
  return new Response(JSON.stringify({ ok: status === 200, estado, mensaje }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      ...extraHeaders,
    },
  });
}

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (rateBuckets.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateBuckets.set(ip, recent);
  if (rateBuckets.size > 5000) {
    for (const [key, times] of rateBuckets) {
      if (!times.length || now - times[times.length - 1] > RATE_LIMIT_WINDOW_MS) rateBuckets.delete(key);
    }
  }
  return recent.length > RATE_LIMIT_MAX;
}

/** Devuelve true si los datos tienen exactamente la estructura y el contenido esperados. */
function validateDatos(datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) return false;
  const keys = Object.keys(datos);
  if (keys.length !== ALLOWED_KEYS.size) return false;
  for (const k of keys) {
    if (!ALLOWED_KEYS.has(k)) return false;
    const v = datos[k];
    if (typeof v !== 'string' || v.length > MAX_FIELD_CHARS) return false;
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v)) return false;
    // Evita que un texto se interprete como fórmula al llegar a Excel (=, +, @, tabulación, retorno).
    if (/^[=+@\t\r]/.test(v)) return false;
  }

  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(datos['Fecha y hora'])) return false;

  // Obligatorias: todas las preguntas visibles, igual que en el formulario.
  for (const k of QUESTION_KEYS) {
    const required = CONDITIONS[k] ? CONDITIONS[k](datos) : true;
    if (required && !datos[k].trim()) return false;
  }

  // Número de documento: misma regla del formulario.
  const doc = datos.Q2.trim();
  const docOk = datos.Q1 === 'Pasaporte' ? /^[A-Z0-9]{5,15}$/.test(doc) : /^[0-9]{5,11}$/.test(doc);
  if (!docOk) return false;

  // Fechas del formulario (aaaa-mm-dd).
  for (const k of ['Q4', 'Q29']) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datos[k])) return false;
  }
  return true;
}

async function verifyTurnstile(token, secret, ip, expectedHost) {
  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  form.append('idempotency_key', crypto.randomUUID());

  const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form });
  if (!res.ok) throw new Error('turnstile_http');
  const out = await res.json();
  if (!out || out.success !== true) return false;
  if (TURNSTILE_TEST_SECRETS.has(secret)) return true;
  if (out.action !== TURNSTILE_ACTION) return false;
  if (out.hostname !== expectedHost) return false;
  return true;
}

async function handlePost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const ip = request.headers.get('CF-Connecting-IP') || '';

  // 1. Solo desde la propia página (si el navegador declara su origen).
  const origin = request.headers.get('Origin');
  if (origin) {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch (_) { /* origen inválido */ }
    if (originHost !== url.host) return respond(403, 'seguridad', MSG.seguridad);
  }

  // 2. Control de solicitudes excesivas.
  if (ip && isRateLimited(ip)) {
    return respond(429, 'limite', MSG.limite, { 'Retry-After': '600' });
  }

  // 3. Content-Type y tamaño.
  const contentType = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) return respond(415, 'validacion', MSG.validacion);
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BODY_BYTES) return respond(413, 'validacion', MSG.validacion);

  let raw;
  try { raw = await request.text(); } catch (_) { return respond(400, 'validacion', MSG.validacion); }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return respond(413, 'validacion', MSG.validacion);

  // 4. Estructura JSON: { token, datos } y nada más.
  let body;
  try { body = JSON.parse(raw); } catch (_) { return respond(400, 'validacion', MSG.validacion); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return respond(400, 'validacion', MSG.validacion);
  const topKeys = Object.keys(body);
  if (topKeys.length !== 2 || !topKeys.includes('token') || !topKeys.includes('datos')) {
    return respond(400, 'validacion', MSG.validacion);
  }
  const { token, datos } = body;
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_CHARS) {
    return respond(403, 'seguridad', MSG.seguridad);
  }

  // 5. Campos y reglas del formulario.
  if (!validateDatos(datos)) return respond(422, 'validacion', MSG.validacion);

  // 6. Configuración del servidor (sin revelar detalles).
  const secret = env.TURNSTILE_SECRET_KEY;
  const flowUrl = env.POWER_AUTOMATE_URL;
  if (!secret || !flowUrl || !/^https:\/\//i.test(flowUrl)) {
    console.error('Configuración incompleta: falta TURNSTILE_SECRET_KEY o POWER_AUTOMATE_URL.');
    return respond(503, 'temporal', MSG.temporal);
  }

  // 7. Turnstile validado en el servidor.
  try {
    const human = await verifyTurnstile(token, secret, ip, url.hostname);
    if (!human) return respond(403, 'seguridad', MSG.seguridad);
  } catch (_) {
    console.error('No fue posible contactar el servicio de verificación Turnstile.');
    return respond(503, 'temporal', MSG.temporal);
  }

  // 8. Reenvío a Power Automate con exactamente la misma estructura de siempre.
  const payload = { 'Fecha y hora': datos['Fecha y hora'] };
  for (const k of QUESTION_KEYS) payload[k] = datos[k];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POWER_AUTOMATE_TIMEOUT_MS);
  try {
    const res = await fetch(flowUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`Power Automate respondió con estado ${res.status}.`);
      return respond(502, 'temporal', MSG.temporal);
    }
  } catch (_) {
    console.error('No fue posible contactar Power Automate.');
    return respond(504, 'temporal', MSG.temporal);
  } finally {
    clearTimeout(timer);
  }

  return respond(200, 'exito', MSG.ok);
}

// Única entrada: solo POST. Cualquier otro método (GET, PUT, DELETE, OPTIONS…) se rechaza.
export async function onRequest(context) {
  if (context.request.method !== 'POST') {
    return respond(405, 'metodo', MSG.metodo, { Allow: 'POST' });
  }
  return handlePost(context);
}
