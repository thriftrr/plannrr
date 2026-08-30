// Reports how the server is configured without exposing any secrets.
export default defineEventHandler(() => {
  const { ynabPersonalAccessToken, ynabMock } = useRuntimeConfig()
  return {
    mock: Boolean(ynabMock),
    hasToken: Boolean(ynabPersonalAccessToken)
  }
})
