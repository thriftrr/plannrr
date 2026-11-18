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
      // NUXT_ADMIN_EMAILS, or Authrr's `admin` role — see utils/admin.ts
      isAdmin: isAdminUser(user),
      // connected through "Sign in with YNAB" — the only way YNAB access is held
      ynabConnected: Boolean(user.ynabRefreshCipher),
      ynabOauthAvailable: oauthConfigured(),
      firstName: user.firstName,
      lastName: user.lastName,
      currency: user.currency ?? 'USD',
      palette: user.palette ?? null,
      onboardingDismissedAt: user.onboardingDismissedAt ?? null,
      // Cache-bust on the key so a replaced photo shows up immediately.
      avatarUrl: user.avatarKey ? `/api/account/avatar?v=${encodeURIComponent(user.avatarKey)}` : null,
      // Name and palette live in Authrr when sign-in goes through it (and
      // change there): the account page shows them read-only.
      authrr: Boolean(user.authrrSub) && authrrEnabled()
    }
  }
})
