import { CURRENCY_CODES } from '#shared/types/currency'
import type { ProfilePatch } from '../../utils/auth-db'

const MAX_NAME = 60

// Trims to null so an emptied field clears rather than storing "".
function cleanName (value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Names must be text' })
  }
  const trimmed = value.trim()
  if (trimmed.length > MAX_NAME) {
    throw createError({ statusCode: 400, statusMessage: `Keep names under ${MAX_NAME} characters` })
  }
  return trimmed || null
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<{ firstName?: unknown, lastName?: unknown, currency?: unknown }>(event)

  const patch: ProfilePatch = {}

  const first = cleanName(body?.firstName)
  if (first !== undefined) patch.firstName = first
  const last = cleanName(body?.lastName)
  if (last !== undefined) patch.lastName = last

  if (body?.currency !== undefined) {
    const code = String(body.currency)
    if (!CURRENCY_CODES.includes(code)) {
      throw createError({ statusCode: 400, statusMessage: 'Unsupported currency' })
    }
    patch.currency = code
  }

  await updateUserProfile(user.id, patch)
  return { ok: true }
})
