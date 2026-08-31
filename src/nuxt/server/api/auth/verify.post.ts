export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: string }>(event)
  const token = body?.token
  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'Missing token' })
  }

  const email = await spendLoginToken(hashLoginToken(token))
  if (!email) {
    throw createError({ statusCode: 400, statusMessage: 'This sign-in link is invalid or has expired. Request a new one.' })
  }

  const user = await ensureUser(email)
  await startSession(event, { id: user.id, email: user.email })
  return { user: { email: user.email } }
})
