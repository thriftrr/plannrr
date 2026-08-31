export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<{ pat?: string }>(event)
  const pat = body?.pat?.trim()
  if (!pat || pat.length < 20) {
    throw createError({ statusCode: 400, statusMessage: 'That does not look like a YNAB personal access token' })
  }
  await setUserPat(user.id, encryptSecret(pat))
  return { ok: true }
})
