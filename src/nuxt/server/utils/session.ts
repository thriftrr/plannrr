import type { H3Event } from 'h3'
import { SignJWT, jwtVerify } from 'jose'

// Session pattern mirrors hivrr: a signed JWT in an httpOnly cookie.
const SESSION_COOKIE = 'ynabrr_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

export interface SessionUser {
  id: string
  email: string
}

function sessionSecret () {
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
}

export function endSession (event: H3Event) {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

export async function getSessionUser (event: H3Event): Promise<SessionUser | null> {
  const raw = getCookie(event, SESSION_COOKIE)
  if (!raw) return null
  try {
    const { payload } = await jwtVerify(raw, sessionSecret())
    if (!payload.sub || typeof payload.email !== 'string') return null
    return { id: payload.sub, email: payload.email }
  } catch {
    return null
  }
}

export async function requireUser (event: H3Event): Promise<SessionUser> {
  const user = await getSessionUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Sign in required' })
  return user
}
