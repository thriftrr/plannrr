// The budgets a saved PAT can see, for the "which ones do you want?" picker.
// One live call; marks the ones already snapshotted locally.
export default defineEventHandler(async (event) => {
  const owner = await requireDebtOwner(event)
  const pat = await resolvePat(event)
  if (!pat) throw createError({ statusCode: 400, statusMessage: 'Save a YNAB token first' })

  let plans: Array<{ id: string, name: string, currency_format?: { iso_code: string, currency_symbol: string } | null }>
  try {
    plans = (await ynabApi<{ plans: typeof plans }>(pat, '/plans')).plans
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'YNAB rejected the token — check it under YNAB → Account Settings → Developer' })
  }

  const sources = await listPlanSources(owner)
  const syncedIds = new Set(sources.filter(s => s.ynabPlanId).map(s => s.ynabPlanId))

  return {
    plans: plans.map(plan => ({
      id: plan.id,
      name: plan.name,
      currency: plan.currency_format?.iso_code ?? 'USD',
      synced: syncedIds.has(plan.id)
    }))
  }
})
