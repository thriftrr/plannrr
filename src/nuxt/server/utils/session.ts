import type { H3Event } from 'h3'
import { SignJWT, jwtVerify } from 'jose'

// Session pattern mirrors hivrr: a signed JWT in an httpOnly cookie.
const SESSION_COOKIE = 'ynabrr_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
// With Authrr on, the session is re-checked with it at most this often, so a
// ban or a removed grant there reaches here without a 30-day wait.
const AUTH_SWEEP_MS = 60 * 60 * 1000

export interface SessionUser {
  id: string
  email: string
}

// One lookup per request, however many handlers ask. It matters with Authrr:
// the sweep below may call Authrr, and that call must not happen once per
// endpoint on the same page.
const resolved = new WeakMap<H3Event, SessionUser | null>()

// Also signs the Authrr sign-in state cookie (server/utils/authrr.ts), under
// its own audience.
export function sessionSecret () {
  const { sessionSecret: secret } = useRuntimeConfig()
  if (secret) return new TextEncoder().encode(secret)
  if (import.meta.dev) return new TextEncoder().encode('ynabrr-dev-session-secret-not-for-production')
  throw createError({ statusCode: 500, statusMessage: 'NUXT_SESSION_SECRET is not set' })
}

export async function startSession (event: H3Event, user: SessionUser) {
  const token = await new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(sessionSecret())

  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS,
    path: '/'
  })
  resolved.set(event, { id: user.id, email: user.email })
}

export function endSession (event: H3Event) {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
  resolved.set(event, null)
}

export async function getSessionUser (event: H3Event): Promise<SessionUser | null> {
  if (resolved.has(event)) return resolved.get(event) ?? null
  const user = await readSession(event)
  resolved.set(event, user)
  return user
}

async function readSession (event: H3Event): Promise<SessionUser | null> {
  const raw = getCookie(event, SESSION_COOKIE)
  if (!raw) return null
  let user: SessionUser
  try {
    const { payload } = await jwtVerify(raw, sessionSecret())
    if (!payload.sub || typeof payload.email !== 'string') return null
    user = { id: payload.sub, email: payload.email }
  } catch {
    return null
  }

  // With Authrr, this is when it's asked whether the person is still allowed
  // in. Unreachable means ask again next request, so the session stands — an
  // outage there shouldn't sign everyone out here.
  if (authrrEnabled() && await authrrSweepDue(user.id)) {
    const allowed = await authrrStillAllows(event, user.id)
    if (allowed === false) {
      await markAuthrrChecked(user.id).catch(() => { /* best effort */ })
      deleteCookie(event, SESSION_COOKIE, { path: '/' })
      return null
    }
  }
  return user
}

// Most requests only read the timestamp: only an hour-old one goes to Authrr.
async function authrrSweepDue (userId: string): Promise<boolean> {
  const user = await getUserById(userId)
  const at = user?.authrrCheckedAt
  return !at || Date.now() - new Date(at).getTime() > AUTH_SWEEP_MS
}

export async function requireUser (event: H3Event): Promise<SessionUser> {
  const user = await getSessionUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Sign in required' })
  return user
}
