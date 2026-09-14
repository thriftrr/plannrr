// Reports how the server sees this request without exposing any secrets.
export default defineEventHandler(async (event) => {
  const { ynabPersonalAccessToken, ynabMock } = useRuntimeConfig()
  const session = await getSessionUser(event)
  const user = session ? await getUserById(session.id) : null
  return {
    mock: Boolean(ynabMock),
    authenticated: Boolean(user),
    email: user?.email ?? null,
    ynabConnected: Boolean(user?.ynabRefreshCipher),
    // The operator's own token for the personal no-login mode. Reported only
    // where the server honors it (dev), so the client never opens a door the
    // API keeps shut.
    hasEnvPat: import.meta.dev && Boolean(ynabPersonalAccessToken)
  }
})
