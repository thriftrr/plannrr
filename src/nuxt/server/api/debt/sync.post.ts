import type { ImportedAccount } from '../../utils/ynab-import'

// Pulls debt accounts from the selected budgets into the debts table.
// Rows are upserted by source key, so re-syncing refreshes balances and
// history while manual entries and user-set rates survive untouched.
export default defineEventHandler(async (event) => {
  const owner = await requireDebtOwner(event)
  const body = await readBody<{ planIds?: string[] }>(event)
  const planIds = (body?.planIds ?? []).filter(id => typeof id === 'string').slice(0, 50)
  if (!planIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'Pick at least one budget to sync from' })
  }

  let created = 0
  let updated = 0
  let liveError = false

  const user = await getSessionUser(event)
  const importIds = planIds.filter(id => id.startsWith('imp_'))
  const liveIds = planIds.filter(id => !id.startsWith('imp_'))

  if (user && importIds.length) {
    const rows = await listImportedPlans(user.id)
    for (const id of importIds) {
      const row = rows.find(item => item.id === id)
      if (!row) continue
      const parsed = await kv.get<{ accounts?: ImportedAccount[] }>(importKey(user.id, id))
      for (const account of parsed?.accounts ?? []) {
        if (account.balance >= 0 || !account.history.length) continue
        const result = await upsertSyncedDebt(owner, 'import', `${id}:${account.name}`, {
          planName: `${row.name} (import)`,
          name: account.name,
          startDate: account.startDate,
          startBalance: account.startBalance,
          balance: account.balance,
          paidIn: account.paidIn,
          history: account.history
        })
        result === 'created' ? created++ : updated++
      }
    }
  }

  if (liveIds.length) {
    const pat = await resolvePat(event)
    if (!pat) {
      liveError = true
    } else {
      try {
        const sources = await fetchLiveDebtSources(pat, liveIds)
        for (const source of sources) {
          for (const account of source.accounts) {
            const result = await upsertSyncedDebt(owner, 'ynab', `${source.planId}:${account.name}`, {
              planName: source.planName,
              name: account.name,
              startDate: account.startDate,
              startBalance: account.startBalance,
              balance: account.balance,
              paidIn: account.paidIn,
              rate: account.rate,
              minimumPayment: account.minimumPayment,
              history: account.history
            })
            result === 'created' ? created++ : updated++
          }
        }
      } catch {
        liveError = true
      }
    }
  }

  return { created, updated, live_error: liveError }
})
