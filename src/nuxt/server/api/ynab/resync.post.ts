// Force-refresh from the connected YNAB account. Local-first: pages read
// snapshots, so a re-sync means (1) prove the connection, (2) re-snapshot
// every synced budget source, (3) re-pull debt accounts as before.
export default defineEventHandler(async (event) => {
  const { ynabMock } = useRuntimeConfig()
  if (ynabMock) {
    const { plans } = resolveYnabMock('/plans') as { plans: Array<{ id: string }> }
    return { ok: true, mocked: true, budgets: plans.length, sources_refreshed: 0, plans_synced: 0, created: 0, updated: 0, first_pull: false }
  }

  const owner = await requireDebtOwner(event)
  const token = await resolveYnabAccessToken(event)
  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'Sign in with YNAB first — connect it on the Account page' })
  }

  // One live sync per cooldown window — 429 carries the seconds remaining.
  await assertSyncAllowed(owner)

  let plans: Array<{ id: string, name: string, currency_format?: { iso_code: string, currency_symbol: string } | null }>
  try {
    plans = (await ynabApi<{ plans: typeof plans }>(token, '/plans')).plans
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'YNAB rejected the connection — reconnect with YNAB on the Account page'
    })
  }

  // Refresh every synced source that still exists in YNAB.
  let refreshed = 0
  const sources = (await listPlanSources(owner)).filter(row => row.kind === 'synced' && row.ynabPlanId)
  for (const row of sources) {
    const plan = plans.find(p => p.id === row.ynabPlanId)
    if (!plan) continue
    const snapshot = await snapshotYnabPlan(token, plan)
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
    const counts = await syncLiveDebtPlans(owner, token, targets)
    created = counts.created
    updated = counts.updated
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'YNAB answered, but pulling debt accounts failed — try again' })
  }

  await recordSync(owner)
  return { ok: true, budgets: plans.length, sources_refreshed: refreshed, plans_synced: targets.length, created, updated, first_pull: firstPull }
})
