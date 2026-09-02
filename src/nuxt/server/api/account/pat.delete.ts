// "Disconnect YNAB": drops the pasted token and any OAuth grant. (Revoking
// the grant on YNAB's side is done there, under Developer settings.)
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  await setUserPat(user.id, null)
  await setUserYnabOauth(user.id, { ynabRefreshCipher: null, ynabAccessCipher: null, ynabAccessExpiresAt: null })
  return { ok: true }
})
