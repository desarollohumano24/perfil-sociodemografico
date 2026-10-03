"""Genera la carpeta para subir a Cloudflare Pages arrastrando archivos (Direct Upload).
El panel de Cloudflare no compila la carpeta functions/ en ese modo, así que las
funciones se empaquetan en un único _worker.js (modo avanzado de Pages)."""
import pathlib, re, shutil, sys

root = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root / "dist")
if out.exists():
    shutil.rmtree(out)
shutil.copytree(root / "public", out)

enviar = (root / "functions/api/enviar.js").read_text(encoding="utf-8")
config = (root / "functions/api/config.js").read_text(encoding="utf-8")
enviar = enviar.replace("export async function onRequest(context)", "async function enviarHandler(context)")
config = config.replace("export async function onRequest(context)", "async function configHandler(context)")
assert "export " not in enviar and "export " not in config

worker = f'''/**
 * _worker.js — Cloudflare Pages (modo avanzado, para subida por arrastre).
 * Generado por scripts/build-direct-upload.py a partir de functions/api/*.js. No editar a mano.
 *
 * SECRETOS (se configuran en Cloudflare, nunca en este archivo):
 *   POWER_AUTOMATE_URL   = [CONFIGURAR EN CLOUDFLARE COMO SECRET]
 *   TURNSTILE_SECRET_KEY = [CONFIGURAR EN CLOUDFLARE COMO SECRET]
 *   TURNSTILE_SITE_KEY   = [CONFIGURAR EN CLOUDFLARE] (pública)
 */

// ===== /api/enviar =====
{enviar}

// ===== /api/config =====
{config}

// ===== Encabezados de seguridad para todo lo demás (páginas y archivos) =====
const SECURITY_HEADERS = {{
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
}};

export default {{
  async fetch(request, env, ctx) {{
    const {{ pathname }} = new URL(request.url);
    if (pathname === '/api/enviar') return enviarHandler({{ request, env, ctx }});
    if (pathname === '/api/config') return configHandler({{ request, env, ctx }});
    if (pathname === '/_worker.js' || pathname.startsWith('/api/')) {{
      return new Response('No encontrado', {{ status: 404, headers: SECURITY_HEADERS }});
    }}
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  }},
}};
'''
(out / "_worker.js").write_text(worker, encoding="utf-8")
print(out)
