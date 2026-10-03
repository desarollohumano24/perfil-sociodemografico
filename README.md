# Perfil sociodemográfico — ANGIOSUR

Formulario web del perfil sociodemográfico. Las respuestas llegan a Excel mediante Power Automate.

```
Colaborador → página (Cloudflare Pages) → Turnstile → /api/enviar (Pages Function) → Power Automate → Excel
```

El navegador **nunca** se comunica con Power Automate. La URL del flujo existe solo como **secreto en Cloudflare**.

## Estructura

| Ruta | Qué es |
|---|---|
| `public/index.html` | Formulario (mismo contenido y diseño de siempre) |
| `public/css/styles.css` | Estilos (antes dentro del HTML) |
| `public/js/app.js` | Lógica del formulario (antes dentro del HTML) + Turnstile + envío a `/api/enviar` |
| `public/_headers` | Encabezados de seguridad y `noindex` |
| `public/robots.txt` | Indicaciones para buscadores |
| `functions/api/enviar.js` | Intermediario: valida, verifica Turnstile y reenvía a Power Automate |
| `functions/api/config.js` | Entrega la Site Key pública de Turnstile |

## Variables en Cloudflare Pages

Se configuran en **Workers y Pages → (proyecto) → Configuración → Variables y secretos**, entorno **Producción**. Nunca se escriben en el código.

| Nombre | Tipo | Valor |
|---|---|---|
| `POWER_AUTOMATE_URL` | **Secreto** | URL completa del disparador HTTP del flujo (la nueva, regenerada) |
| `TURNSTILE_SECRET_KEY` | **Secreto** | Secret Key del widget de Turnstile |
| `TURNSTILE_SITE_KEY` | Texto | Site Key del widget de Turnstile (es pública) |

Después de crear o cambiar una variable hay que **volver a implementar** (Implementaciones → … → Reintentar implementación).

## Configuración de compilación en Cloudflare Pages

- Rama de producción: `cloudflare`
- Valor predeterminado del framework: **Ninguno**
- Comando de compilación: *(vacío)*
- Directorio de salida de la compilación: `public`

La carpeta `functions/` la detecta Cloudflare automáticamente.

## Pruebas locales (opcional, para desarrolladores)

1. Copiar `.dev.vars.example` como `.dev.vars` y completar (este archivo está en `.gitignore`).
2. `npx wrangler pages dev public`

## Respuestas de `/api/enviar`

| Estado | `estado` | Cuándo |
|---|---|---|
| 200 | `exito` | Fila enviada a Power Automate |
| 400 / 413 / 415 / 422 | `validacion` | JSON mal formado, muy grande, campos faltantes o inesperados |
| 403 | `seguridad` | Turnstile no válido u origen distinto |
| 405 | `metodo` | Método distinto de POST |
| 429 | `limite` | Demasiados envíos desde la misma IP |
| 502 / 503 / 504 | `temporal` | Power Automate o Turnstile no responden, o faltan variables |
