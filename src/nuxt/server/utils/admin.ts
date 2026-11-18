import type { H3Event } from 'h3'

// Admin is decided by email alone (NUXT_ADMIN_EMAILS, comma-separated) — no
// role column, no UI to grant it. Sign-in is by magic link, so owning the
// address IS the proof. Signed in through Authrr, its `admin` role counts
// too: that's where admins are made for every app at once.
export function adminEmails (): string[] {
  const { adminEmails: raw } = useRuntimeConfig()
  return String(raw ?? '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

export function isAdminEmail (email: string | null | undefined): boolean {
  if (!email) return false
  return adminEmails().includes(email.trim().toLowerCase())
}

// The role is written at sign-in from Authrr's claims (server/utils/authrr.ts)
// and refreshed with every session sweep, so it's as current as the session.
export function isAdminUser (user: { email: string, role?: string | null }): boolean {
  return isAdminEmail(user.email) || (authrrEnabled() && user.role === 'admin')
}

export async function requireAdmin (event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event)
  const row = await getUserById(user.id)
  if (!row || !isAdminUser(row)) {
    throw createError({ statusCode: 403, statusMessage: 'Admins only' })
  }
  return user
}
