// "Disconnect YNAB": forgets the tokens "Sign in with YNAB" issued. Revoking
// the grant on YNAB's side is done there, under Account Settings → Developer.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  await setUserYnabOauth(user.id, { ynabRefreshCipher: null, ynabAccessCipher: null, ynabAccessExpiresAt: null })
  return { ok: true }
})
