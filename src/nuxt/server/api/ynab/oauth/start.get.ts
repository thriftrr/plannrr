// Sends the signed-in user to YNAB's authorization screen.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  if (!oauthConfigured()) {
    throw createError({ statusCode: 404, statusMessage: 'Sign in with YNAB is not configured on this instance' })
  }
  return sendRedirect(event, beginOauthFlow(event, user.id), 302)
})
