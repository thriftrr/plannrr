// Imports the chosen YNAB budgets as local snapshots. After this, every page
// reads the snapshot — YNAB is only touched again by an explicit re-sync.
export default defineEventHandler(async (event) => {
  const owner = await requireDebtOwner(event)
  const token = await resolveYnabAccessToken(event)
  if (!token) throw createError({ statusCode: 400, statusMessage: 'Sign in with YNAB first — connect it on the Account page' })

  const body = await readBody<{ planIds?: string[] }>(event)
  const planIds = (body?.planIds ?? []).filter(id => typeof id === 'string').slice(0, 20)
  if (!planIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'Pick at least one plan to import' })
  }

  // Shares the 120s window with every other live sync.
  await assertSyncAllowed(owner)

  let livePlans: Array<{ id: string, name: string, currency_format?: { iso_code: string, currency_symbol: string } | null }>
  try {
    livePlans = (await ynabApi<{ plans: typeof livePlans }>(token, '/plans')).plans
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'YNAB rejected the connection — reconnect with YNAB on the Account page' })
  }

  let created = 0
  let updated = 0
  for (const planId of planIds) {
    const plan = livePlans.find(p => p.id === planId)
    if (!plan) continue
    const snapshot = await snapshotYnabPlan(token, plan)
    const existing = await findSourceByYnabPlan(owner, plan.id)
    const sourceId = existing?.id ?? `${SOURCE_PREFIX}${crypto.randomUUID()}`
    await saveSnapshot(owner, sourceId, snapshot)
    await upsertPlanSource({
      id: sourceId,
      userId: owner,
      name: plan.name,
      monthCount: snapshot.months.length,
      kind: 'synced',
      ynabPlanId: plan.id,
      currencyCode: plan.currency_format?.iso_code ?? 'USD',
      lastSyncedAt: snapshot.syncedAt ?? new Date().toISOString()
    })
    existing ? updated++ : created++
  }

  await recordSync(owner)
  return { ok: true, created, updated }
})
