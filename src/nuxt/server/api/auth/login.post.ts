const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string }>(event)
  const email = body?.email?.trim().toLowerCase()
  if (!email || !EMAIL_RE.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid email is required' })
  }

  const token = generateLoginToken()
  await insertLoginToken(hashLoginToken(token), email, loginTokenExpiry())

  const config = useRuntimeConfig()
  const origin = config.appOrigin || getRequestURL(event).origin
  const link = `${origin}/auth/verify?token=${token}`

  await sendEmail(event, {
    to: email,
    subject: 'Sign in to YNABRR',
    text: `Here's your sign-in link (valid for 15 minutes):\n\n${link}\n\nIf you didn't request this, you can ignore this email.`,
    html: `<p>Here's your sign-in link (valid for 15 minutes):</p><p><a href="${link}">Sign in to YNABRR</a></p><p>If you didn't request this, you can ignore this email.</p>`
  })

  // In dev the console transport is the outbox; surfacing the link in the
  // response makes local testing painless. Never included in production.
  return { ok: true, ...(import.meta.dev ? { devLink: link } : {}) }
})
