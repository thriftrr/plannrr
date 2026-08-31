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
  }>(event)

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
