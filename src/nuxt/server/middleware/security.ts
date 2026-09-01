// Baseline security headers on every response.
export default defineEventHandler((event) => {
  setResponseHeaders(event, {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(import.meta.dev ? {} : { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' })
  })
})
