// Baseline security headers on every response.
//
// The CSP is production-only (dev needs Vite's websocket + eval). Inline
// script/style stay allowed because Nuxt's hydration payload and scoped
// styles are inline; everything else is same-origin, plus Gravatar (avatars)
// and Iconify (icon data when a set isn't bundled).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://www.gravatar.com",
  "font-src 'self' data:",
  "connect-src 'self' https://api.iconify.design",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join('; ')

export default defineEventHandler((event) => {
  setResponseHeaders(event, {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(import.meta.dev ? {} : {
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': CSP
    })
  })
})
