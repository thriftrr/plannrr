import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// AES-256-GCM for YNAB tokens at rest. The key derives from NUXT_PAT_SECRET
// (falling back to the session secret) so a copied database alone can't
// reveal tokens.

function patKey (): Buffer {
  const config = useRuntimeConfig()
  const secret = config.patSecret || config.sessionSecret
    || (import.meta.dev ? 'ynabrr-dev-pat-secret-not-for-production' : '')
  if (!secret) {
    throw createError({ statusCode: 500, statusMessage: 'NUXT_PAT_SECRET is not set' })
  }
  return createHash('sha256').update(`ynabrr-pat:${secret}`).digest()
}

export function encryptSecret (plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', patKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

export function decryptSecret (sealed: string): string | null {
  try {
    const [iv, tag, data] = sealed.split('.')
    if (!iv || !tag || !data) return null
    const decipher = createDecipheriv('aes-256-gcm', patKey(), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
