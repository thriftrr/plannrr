// YNAB sends the browser back here with ?code&state. Everything that can go
// wrong lands the user on the account page with a reason, never a raw error.
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const back = (status: string) => sendRedirect(event, `/account?ynab=${status}#ynab-token`, 302)

  const session = await getSessionUser(event)
  const flow = readOauthFlow(event)
  if (!session || !flow || flow.userId !== session.id) return back('expired')
  if (typeof query.error === 'string') return back(query.error === 'access_denied' ? 'denied' : 'error')
  if (typeof query.state !== 'string' || query.state !== flow.state || typeof query.code !== 'string') return back('error')

  try {
    await exchangeOauthCode(event, session.id, query.code, flow.verifier)
  } catch {
    return back('error')
  }
  return back('connected')
})
