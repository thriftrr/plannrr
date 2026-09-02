import { randomBytes } from 'node:crypto'

// Baseline security headers on every response, plus a per-request nonce for
// the Content-Security-Policy. server/plugins/csp-nonce.ts stamps the nonce
// onto every <script> Nuxt renders, so inline scripts (the runtime-config
// script, the palette-boot script in app.vue) run without 'unsafe-inline'
// and 'strict-dynamic' lets those trusted scripts load what they import
// (Vite chunks) without a host allowlist. Inline event handlers
// (onclick="…") and javascript: links are therefore blocked — use Vue
// listeners.
//
// Styles keep 'unsafe-inline': Nuxt inlines scoped CSS, Vue binds :style
// attributes everywhere, and ProseMirror (the feedback editor) injects a
// <style> element at runtime. Nonces can't cover attributes, and CSS can't
// run code, so the trade is a small one.
//
// The CSP is production-only (dev needs Vite's websocket + eval).
function csp (nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    // Gravatar for avatars.
    "img-src 'self' data: blob: https://www.gravatar.com",
    "font-src 'self' data:",
    // Iconify: icon data when a set isn't bundled.
    "connect-src 'self' https://api.iconify.design",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join('; ')
}

export default defineEventHandler((event) => {
  const nonce = randomBytes(16).toString('base64')
  event.context.cspNonce = nonce

  setResponseHeaders(event, {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ...(import.meta.dev ? {} : {
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': csp(nonce)
    })
  })
})
