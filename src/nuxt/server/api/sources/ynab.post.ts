// Imports the chosen YNAB budgets as local snapshots. After this, every page
// reads the snapshot — YNAB is only touched again by an explicit re-sync.
export default defineEventHandler(async (event) => {
  const owner = await requireDebtOwner(event)
  const pat = await resolvePat(event)
  if (!pat) throw createError({ statusCode: 400, statusMessage: 'Save a YNAB token first' })

  const body = await readBody<{ planIds?: string[] }>(event)
  const planIds = (body?.planIds ?? []).filter(id => typeof id === 'string').slice(0, 20)
  if (!planIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'Pick at least one plan to import' })
  }

  // Shares the 120s window with every other live sync.
  await assertSyncAllowed(owner)

  let livePlans: Array<{ id: string, name: string, currency_format?: { iso_code: string, currency_symbol: string } | null }>
  try {
    livePlans = (await ynabApi<{ plans: typeof livePlans }>(pat, '/plans')).plans
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'YNAB rejected the token — check it under YNAB → Account Settings → Developer' })
  }

  let created = 0
  let updated = 0
  for (const planId of planIds) {
    const plan = livePlans.find(p => p.id === planId)
    if (!plan) continue
    const snapshot = await snapshotYnabPlan(pat, plan)
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
