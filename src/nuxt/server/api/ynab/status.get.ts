// Reports how the server sees this request without exposing any secrets.
export default defineEventHandler(async (event) => {
  const { ynabPersonalAccessToken, ynabMock } = useRuntimeConfig()
  const session = await getSessionUser(event)
  const user = session ? await getUserById(session.id) : null
  return {
    mock: Boolean(ynabMock),
    authenticated: Boolean(user),
    email: user?.email ?? null,
    hasPat: Boolean(user?.patCipher),
    hasEnvPat: Boolean(ynabPersonalAccessToken)
  }
})
