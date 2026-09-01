// Live-debt sync core, shared by the debt page's "Sync now" (explicit plan
// picks) and the Account page's "Re-sync from YNAB" (re-pulls what's synced).

export interface SyncCounts { created: number, updated: number }

export async function syncLiveDebtPlans (owner: string, pat: string, planIds: string[]): Promise<SyncCounts> {
  let created = 0
  let updated = 0
  const sources = await fetchLiveDebtSources(pat, planIds)
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
  return { created, updated }
}
