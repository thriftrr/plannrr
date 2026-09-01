export default defineEventHandler(async (event) => {
  const session = await getSessionUser(event)
  if (!session) return { user: null }
  const user = await getUserById(session.id)
  if (!user) {
    endSession(event)
    return { user: null }
  }
  return {
    user: {
      email: user.email,
      hasPat: Boolean(user.patCipher),
      firstName: user.firstName,
      lastName: user.lastName,
      currency: user.currency ?? 'USD',
      // Cache-bust on the key so a replaced photo shows up immediately.
      avatarUrl: user.avatarKey ? `/api/account/avatar?v=${encodeURIComponent(user.avatarKey)}` : null
    }
  }
})
