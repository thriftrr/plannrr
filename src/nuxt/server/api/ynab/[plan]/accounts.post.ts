// Live account balances for one synced budget: one YNAB call, written back
// into the source's snapshot so every page sees the same "right now". Cheap
// enough to run on each Calendrr visit, throttled per source all the same.
import type { BudgetAccount } from '#shared/types/ynab'

export default defineEventHandler(async (event) => {
  const { ynabMock } = useRuntimeConfig()
  const planId = getRouterParam(event, 'plan')!
  const now = new Date().toISOString()

  if (ynabMock) {
    const res = resolveYnabMock(`/plans/${planId}/transactions`) as { accounts?: BudgetAccount[] }
    return { ok: true, mocked: true, accounts: res.accounts ?? [], accounts_at: now }
  }

  const owner = await requireDebtOwner(event)
  const source = await getPlanSource(owner, planId)
  if (!source || source.kind !== 'synced' || !source.ynabPlanId) {
    throw createError({ statusCode: 400, statusMessage: 'Only plans synced from YNAB have live account balances' })
  }
  const pat = await resolvePat(event)
  if (!pat) throw createError({ statusCode: 400, statusMessage: 'Save a YNAB token first' })

  await assertRateLimit([{ key: `accounts:${owner}:${planId}`, limit: 12, windowSeconds: 600 }])

  type ApiAccount = { id: string, name: string, type: string, on_budget?: boolean, closed?: boolean, deleted?: boolean, balance: number }
  let accounts: BudgetAccount[]
  try {
    const res = await ynabApi<{ accounts: ApiAccount[] }>(pat, `/plans/${source.ynabPlanId}/accounts`)
    accounts = res.accounts
      .filter(a => a.on_budget && !a.closed && !a.deleted)
      .map(a => ({ id: a.id, name: a.name, type: a.type, balance: a.balance }))
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'YNAB did not answer for account balances — try again in a moment' })
  }

  const snapshot = await loadSnapshot(owner, planId)
  if (snapshot) {
    snapshot.accounts = accounts
    snapshot.accountBalanceNow = accounts.reduce((sum, a) => sum + a.balance, 0)
    snapshot.accountsAt = now
    await saveSnapshot(owner, planId, snapshot)
  }
  return { ok: true, accounts, accounts_at: now }
})
