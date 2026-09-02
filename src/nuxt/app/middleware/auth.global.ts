// Signed-out visitors land on the sign-in page.
//
// Two modes are legitimately anonymous and must NOT be bounced:
//   - sample-data mode (NUXT_YNAB_MOCK=1)
//   - the personal no-login mode you get by setting
//     NUXT_YNAB_PERSONAL_ACCESS_TOKEN and running the app yourself
// Both are how the app is used without an account at all, so the gate checks
// for them before redirecting.
const PUBLIC_ROUTES = ['/login', '/auth/verify', '/privacy']

export default defineNuxtRouteMiddleware(async (to) => {
  if (PUBLIC_ROUTES.some(path => to.path === path || to.path.startsWith(`${path}/`))) return

  const { user, loaded, refresh } = useAuth()
  if (!loaded.value) await refresh()
  if (user.value) return

  // Resolved once per app load, not per navigation.
  const openAccess = useState<boolean | null>('open-access', () => null)
  if (openAccess.value === null) {
    try {
      const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
      const status = await $fetch<{ mock: boolean, hasEnvPat: boolean }>('/api/ynab/status', { headers })
      openAccess.value = status.mock || status.hasEnvPat
    } catch {
      openAccess.value = false
    }
  }
  if (openAccess.value) return

  return navigateTo('/login')
})
