// YNAB OAuth (Authorization Code + PKCE, server side). Tokens are stored
// encrypted like the PAT; access tokens live two hours and are refreshed
// just before use, so pages never see an expired one.
// https://api.ynab.com/#oauth-applications
import { createHash, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'

const AUTHORIZE_URL = 'https://app.ynab.com/oauth/authorize'
const TOKEN_URL = 'https://app.ynab.com/oauth/token'
const FLOW_COOKIE = 'ynabrr_oauth'
const REFRESH_AHEAD_MS = 5 * 60 * 1000

export function oauthConfigured (): boolean {
  const { ynabClientId, ynabClientSecret } = useRuntimeConfig()
  return Boolean(ynabClientId && ynabClientSecret)
}

export function oauthRedirectUri (event: H3Event): string {
  const { appOrigin } = useRuntimeConfig()
  const origin = appOrigin || (import.meta.dev ? getRequestURL(event).origin : '')
  if (!origin) throw createError({ statusCode: 500, statusMessage: 'NUXT_APP_ORIGIN is not set' })
  return `${origin}/api/ynab/oauth/callback`
}

const b64url = (buf: Buffer) => buf.toString('base64url')

// Starts the flow: state + PKCE verifier ride in a short-lived encrypted
// cookie bound to the signed-in user, so the callback can prove the browser
// that comes back is the one that left.
export function beginOauthFlow (event: H3Event, userId: string): string {
  const { ynabClientId } = useRuntimeConfig()
  const state = b64url(randomBytes(24))
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  setCookie(event, FLOW_COOKIE, encryptSecret(JSON.stringify({ state, verifier, userId, at: Date.now() })), {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/ynab/oauth'
  })
  const params = new URLSearchParams({
    client_id: ynabClientId,
    redirect_uri: oauthRedirectUri(event),
    response_type: 'code',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })
  return `${AUTHORIZE_URL}?${params}`
}

export function readOauthFlow (event: H3Event): { state: string, verifier: string, userId: string } | null {
  const raw = getCookie(event, FLOW_COOKIE)
  deleteCookie(event, FLOW_COOKIE, { path: '/api/ynab/oauth' })
  if (!raw) return null
  const plain = decryptSecret(raw)
  if (!plain) return null
  try {
    const flow = JSON.parse(plain) as { state: string, verifier: string, userId: string, at: number }
    if (Date.now() - flow.at > 600_000) return null
    return flow
  } catch {
    return null
  }
}

interface TokenResponse { access_token: string, refresh_token: string, expires_in: number }

async function tokenRequest (params: Record<string, string>): Promise<TokenResponse> {
  const { ynabClientId, ynabClientSecret } = useRuntimeConfig()
  return await $fetch<TokenResponse>(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: ynabClientId, client_secret: ynabClientSecret, ...params }).toString()
  })
}

async function storeTokens (userId: string, tokens: TokenResponse): Promise<void> {
  await setUserYnabOauth(userId, {
    ynabRefreshCipher: encryptSecret(tokens.refresh_token),
    ynabAccessCipher: encryptSecret(tokens.access_token),
    ynabAccessExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  })
}

export async function exchangeOauthCode (event: H3Event, userId: string, code: string, verifier: string): Promise<void> {
  const tokens = await tokenRequest({
    grant_type: 'authorization_code',
    redirect_uri: oauthRedirectUri(event),
    code,
    code_verifier: verifier
  })
  await storeTokens(userId, tokens)
}

// A usable access token for this user, refreshed when it's about to expire.
// Null when the user never connected via OAuth or the refresh was rejected
// (revoked in YNAB) — callers then fall back to a PAT, if any.
export async function resolveOauthAccessToken (user: DbUser): Promise<string | null> {
  if (!user.ynabRefreshCipher) return null
  const expiresAt = user.ynabAccessExpiresAt ? Date.parse(user.ynabAccessExpiresAt) : 0
  if (user.ynabAccessCipher && expiresAt - Date.now() > REFRESH_AHEAD_MS) {
    const access = decryptSecret(user.ynabAccessCipher)
    if (access) return access
  }
  const refresh = decryptSecret(user.ynabRefreshCipher)
  if (!refresh) return null
  try {
    const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh })
    await storeTokens(user.id, tokens)
    return tokens.access_token
  } catch {
    return null
  }
}
