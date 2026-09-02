// Links a hand-built (manual) budget to a real YNAB budget, converting it to
// a synced source. The YNAB API cannot create budgets, so the destination
// must already exist — typically a fresh empty budget made in YNAB's UI.
// After linking, Tinkrr's sync derives create-group / create-category /
// set-target actions for everything built locally, and the first push's
// finalize re-snapshots from YNAB.
export default defineEventHandler(async (event) => {
  const owner = await requireDebtOwner(event)
  const id = getRouterParam(event, 'id')!

  const source = await getPlanSource(owner, id)
  if (!source) throw createError({ statusCode: 404, statusMessage: 'Budget source not found' })
  if (source.kind !== 'manual') {
    throw createError({ statusCode: 400, statusMessage: 'Only hand-built plans can be linked to YNAB' })
  }

  const body = await readBody<{ ynabPlanId?: string }>(event)
  const ynabPlanId = typeof body?.ynabPlanId === 'string' ? body.ynabPlanId : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ynabPlanId)) {
    throw createError({ statusCode: 400, statusMessage: 'Pick a YNAB plan to link to' })
  }

  const pat = await resolvePat(event)
  if (!pat) throw createError({ statusCode: 400, statusMessage: 'Save a YNAB token first' })

  let plans: Array<{ id: string, name: string, currency_format?: { iso_code: string } | null }>
  try {
    plans = (await ynabApi<{ plans: typeof plans }>(pat, '/plans')).plans
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'YNAB rejected the token — check it under YNAB → Account Settings → Developer' })
  }
  const plan = plans.find(p => p.id === ynabPlanId)
  if (!plan) throw createError({ statusCode: 400, statusMessage: 'That plan is not visible to your token' })

  const taken = await findSourceByYnabPlan(owner, ynabPlanId)
  if (taken) {
    throw createError({ statusCode: 409, statusMessage: `“${taken.name}” already syncs from that YNAB plan` })
  }

  // The local snapshot keeps serving until the first push finalizes and
  // re-snapshots the destination — nothing is written to YNAB by linking.
  await upsertPlanSource({
    id: source.id,
    userId: owner,
    name: source.name,
    monthCount: source.monthCount,
    kind: 'synced',
    ynabPlanId,
    currencyCode: plan.currency_format?.iso_code ?? source.currencyCode,
    lastSyncedAt: null
  })
  return { ok: true, linkedTo: plan.name }
})
