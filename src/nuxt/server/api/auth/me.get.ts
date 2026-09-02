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
      isAdmin: isAdminEmail(user.email),
      hasPat: Boolean(user.patCipher || user.ynabRefreshCipher),
      // how YNAB is connected: 'oauth' (Sign in with YNAB), 'pat', or null
      ynabAuth: user.ynabRefreshCipher ? 'oauth' : user.patCipher ? 'pat' : null,
      ynabOauthAvailable: oauthConfigured(),
      firstName: user.firstName,
      lastName: user.lastName,
      currency: user.currency ?? 'USD',
      palette: user.palette ?? null,
      onboardingDismissedAt: user.onboardingDismissedAt ?? null,
      // Cache-bust on the key so a replaced photo shows up immediately.
      avatarUrl: user.avatarKey ? `/api/account/avatar?v=${encodeURIComponent(user.avatarKey)}` : null
    }
  }
})
