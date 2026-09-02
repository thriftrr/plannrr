// Personal access tokens are for their owner's own instance; a public,
// OAuth-configured instance connects through "Sign in with YNAB" only.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  if (oauthConfigured()) {
    throw createError({ statusCode: 400, statusMessage: 'This instance connects through Sign in with YNAB' })
  }
  const body = await readBody<{ pat?: string }>(event)
  const pat = body?.pat?.trim()
  if (!pat || pat.length < 20) {
    throw createError({ statusCode: 400, statusMessage: 'That does not look like a YNAB personal access token' })
  }
  await setUserPat(user.id, encryptSecret(pat))
  return { ok: true }
})
