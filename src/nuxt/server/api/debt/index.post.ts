const MONTH_RE = /^\d{4}-\d{2}(-01)?$/

export default defineEventHandler(async (event) => {
  const owner = await requireDebtOwner(event)
  const body = await readBody<{
    name?: string
    original?: number
    balance?: number
    startMonth?: string
    endMonth?: string
    rate?: number
    payment?: number
  }>(event)

  const name = body?.name?.trim()
  if (!name) throw createError({ statusCode: 400, statusMessage: 'A name is required' })
  const original = Number(body?.original)
  if (!Number.isFinite(original) || original <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Original amount must be a positive number' })
  }
  const balance = Number(body?.balance ?? 0)
  if (!Number.isFinite(balance) || balance < 0 || balance > original) {
    throw createError({ statusCode: 400, statusMessage: 'Balance must be between 0 and the original amount' })
  }
  if (!body?.startMonth || !MONTH_RE.test(body.startMonth)) {
    throw createError({ statusCode: 400, statusMessage: 'Start month is required (YYYY-MM)' })
  }
  if (body?.endMonth && !MONTH_RE.test(body.endMonth)) {
    throw createError({ statusCode: 400, statusMessage: 'Paid-off month must be YYYY-MM' })
  }

  const monthKey = (value: string) => `${value.slice(0, 7)}-01`
  const debt = await createManualDebt(owner, {
    name,
    startBalance: -Math.round(original * 1000),
    balance: -Math.round(balance * 1000),
    startMonth: monthKey(body.startMonth),
    endMonth: body.endMonth ? monthKey(body.endMonth) : null,
    rate: Number.isFinite(Number(body?.rate)) && Number(body?.rate) > 0 ? Number(body.rate) : undefined,
    minimumPayment: Number.isFinite(Number(body?.payment)) && Number(body?.payment) > 0
      ? Math.round(Number(body.payment) * 1000)
      : undefined
  })

  return { debt }
})
