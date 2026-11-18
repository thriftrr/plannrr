// Same-origin paths only, so a crafted ?redirect= can't send someone
// off-site. The Authrr sign-in start route reads it, and the popup hands the
// same value back to the page that opened it.
//
// Browsers drop tabs and newlines from a URL before reading it, so
// "/<tab>/evil.example" is "//evil.example" — another site. Any control
// character or space is refused outright, and what's left has to resolve
// to this origin.
const PROBE = 'http://same.invalid'

export function safeRedirectPath (value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return ''
  // eslint-disable-next-line no-control-regex -- refusing them is the point
  if (value.includes('\\') || /[\u0000-\u0020\u007F-\u009F\u2028\u2029]/.test(value)) return ''
  try {
    return new URL(value, PROBE).origin === PROBE ? value : ''
  } catch {
    return ''
  }
}
