// Force-refresh from YNAB with the saved token. Local-first: pages read
// snapshots, so a re-sync means (1) prove the token, (2) re-snapshot every
// synced budget source, (3) re-pull debt accounts as before.
export default defineEventHandler(async (event) => {
  const { ynabMock } = useRuntimeConfig()
  if (ynabMock) {
    const { plans } = resolveYnabMock('/plans') as { plans: Array<{ id: string }> }
    return { ok: true, mocked: true, budgets: plans.length, sources_refreshed: 0, plans_synced: 0, created: 0, updated: 0, first_pull: false }
  }

  const owner = await requireDebtOwner(event)
  const pat = await resolvePat(event)
  if (!pat) {
    throw createError({ statusCode: 400, statusMessage: 'Save a YNAB token first' })
  }

  // One live sync per cooldown window — 429 carries the seconds remaining.
  await assertSyncAllowed(owner)

  let plans: Array<{ id: string, name: string, currency_format?: { iso_code: string, currency_symbol: string } | null }>
  try {
    plans = (await ynabApi<{ plans: typeof plans }>(pat, '/plans')).plans
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'YNAB rejected the token — check it under YNAB → Account Settings → Developer'
    })
  }

  // Refresh every synced source that still exists in YNAB.
  let refreshed = 0
  const sources = (await listPlanSources(owner)).filter(row => row.kind === 'synced' && row.ynabPlanId)
  for (const row of sources) {
    const plan = plans.find(p => p.id === row.ynabPlanId)
    if (!plan) continue
    const snapshot = await snapshotYnabPlan(pat, plan)
    await saveSnapshot(owner, row.id, snapshot)
    await upsertPlanSource({
      id: row.id,
      userId: owner,
      name: plan.name,
      monthCount: snapshot.months.length,
      kind: 'synced',
      ynabPlanId: plan.id,
      currencyCode: plan.currency_format?.iso_code ?? row.currencyCode,
      lastSyncedAt: snapshot.syncedAt ?? new Date().toISOString()
    })
    refreshed++
  }

  // Debt accounts: refresh the plans synced before, or all on the first pull.
  const liveIds = plans.map(plan => plan.id)
  const prior = (await syncedLivePlanIds(owner)).filter(id => liveIds.includes(id))
  const firstPull = prior.length === 0
  const targets = firstPull ? liveIds : prior

  let created = 0
  let updated = 0
  try {
    const counts = await syncLiveDebtPlans(owner, pat, targets)
    created = counts.created
    updated = counts.updated
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'YNAB answered, but pulling debt accounts failed — try again' })
  }

  await recordSync(owner)
  return { ok: true, budgets: plans.length, sources_refreshed: refreshed, plans_synced: targets.length, created, updated, first_pull: firstPull }
})
