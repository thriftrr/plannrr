const MONTH_DATE_RE = /^\d{4}-\d{2}(-\d{2})?$/

export default defineEventHandler(async (event) => {
  const owner = await requireDebtOwner(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{
    name?: string
    rate?: number | null
    minimumPayment?: number | null
    hidden?: boolean
    userStartDate?: string | null
    userStartBalance?: number | null
    manualShape?: {
      original?: number
      balance?: number
      startMonth?: string
      endMonth?: string | null
    }
  }>(event)

  // Structural edits to a manual row rebuild its history server-side.
  if (body?.manualShape) {
    const source = await getDebtSourceType(owner, id)
    if (source !== 'manual') {
      throw createError({ statusCode: 400, statusMessage: 'Only manual debts can be reshaped — synced rows come from YNAB' })
    }
    const shape = body.manualShape
    const original = Number(shape.original)
    const balance = Number(shape.balance ?? 0)
    if (!Number.isFinite(original) || original <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'Original amount must be a positive number' })
    }
    if (!Number.isFinite(balance) || balance < 0 || balance > original) {
      throw createError({ statusCode: 400, statusMessage: 'Balance must be between 0 and the original amount' })
    }
    if (!shape.startMonth || !MONTH_DATE_RE.test(shape.startMonth)) {
      throw createError({ statusCode: 400, statusMessage: 'Start month is required (YYYY-MM)' })
    }
    if (shape.endMonth && !MONTH_DATE_RE.test(shape.endMonth)) {
      throw createError({ statusCode: 400, statusMessage: 'Paid-off month must be YYYY-MM' })
    }
    const rate = Number(body.rate)
    const minimum = Number(body.minimumPayment)
    const ok = await updateManualDebt(owner, id, {
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
      startBalance: -Math.round(original * 1000),
      balance: -Math.round(balance * 1000),
      startMonth: `${shape.startMonth.slice(0, 7)}-01`,
      endMonth: shape.endMonth ? `${shape.endMonth.slice(0, 7)}-01` : null,
      rate: Number.isFinite(rate) && rate > 0 ? rate : null,
      minimumPayment: Number.isFinite(minimum) && minimum > 0 ? Math.round(minimum) : null
    })
    if (!ok) throw createError({ statusCode: 404, statusMessage: 'Debt not found' })
    return { ok: true }
  }

  const patch: DebtPatch = {}
  if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if ('rate' in (body ?? {})) patch.rate = Number.isFinite(Number(body!.rate)) && Number(body!.rate) > 0 ? Number(body!.rate) : null
  if ('minimumPayment' in (body ?? {})) {
    patch.minimumPayment = Number.isFinite(Number(body!.minimumPayment)) && Number(body!.minimumPayment) > 0
      ? Math.round(Number(body!.minimumPayment))
      : null
  }
  if (typeof body?.hidden === 'boolean') patch.hidden = body.hidden
  if ('userStartDate' in (body ?? {})) {
    if (body!.userStartDate === null) patch.userStartDate = null
    else if (typeof body!.userStartDate === 'string' && MONTH_DATE_RE.test(body!.userStartDate)) {
      patch.userStartDate = `${body!.userStartDate.slice(0, 7)}-01`
    }
  }
  if ('userStartBalance' in (body ?? {})) {
    patch.userStartBalance = body!.userStartBalance === null
      ? null
      : Number.isFinite(Number(body!.userStartBalance)) ? Math.round(Number(body!.userStartBalance)) : null
  }

  if (!Object.keys(patch).length) {
    throw createError({ statusCode: 400, statusMessage: 'Nothing to update' })
  }

  const ok = await patchDebt(owner, id, patch)
  if (!ok) throw createError({ statusCode: 404, statusMessage: 'Debt not found' })
  return { ok: true }
})
