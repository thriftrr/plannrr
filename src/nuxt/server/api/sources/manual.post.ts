import { CURRENCY_CODES, currencySymbol } from '#shared/types/currency'

export default defineEventHandler(async (event) => {
  const owner = await requireDebtOwner(event)
  const body = await readBody<{ name?: string, currency?: string }>(event)

  const name = body?.name?.trim()
  if (!name || name.length > 80) {
    throw createError({ statusCode: 400, statusMessage: 'Give the budget a name (up to 80 characters)' })
  }
  const currency = String(body?.currency ?? 'USD')
  if (!CURRENCY_CODES.includes(currency)) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported currency' })
  }

  const sourceId = `${SOURCE_PREFIX}${crypto.randomUUID()}`
  const snapshot = manualSnapshot(name, { iso_code: currency, currency_symbol: currencySymbol(currency) })
  await saveSnapshot(owner, sourceId, snapshot)
  await upsertPlanSource({
    id: sourceId,
    userId: owner,
    name,
    monthCount: snapshot.months.length,
    kind: 'manual',
    ynabPlanId: null,
    currencyCode: currency,
    lastSyncedAt: null
  })
  return { ok: true, id: sourceId }
})
