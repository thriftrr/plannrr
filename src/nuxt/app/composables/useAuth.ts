export interface AuthUser {
  email: string
  hasPat: boolean
}

// Session state shared across pages; refreshed from /api/auth/me.
export function useAuth () {
  const user = useState<AuthUser | null>('auth-user', () => null)
  const loaded = useState<boolean>('auth-loaded', () => false)

  async function refresh () {
    try {
      const data = await $fetch<{ user: AuthUser | null }>('/api/auth/me')
      user.value = data.user
    } catch {
      user.value = null
    } finally {
      loaded.value = true
    }
  }

  async function logout () {
    await $fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
  }

  return { user, loaded, refresh, logout }
}
