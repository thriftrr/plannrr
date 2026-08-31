import type { DebtSource } from '../../utils/ynab-debt'
import type { ImportedAccount } from '../../utils/ynab-import'

const LIVE_CACHE_TTL_SECONDS = 1800

// Debt histories come from two places: imported plans (rebuilt from each
// export's Register) and, when a PAT is available, the live YNAB API —
// which also knows real interest rates and minimum payments. Live results
// are cached in KV to stay friendly with YNAB's rate limit.
export default defineEventHandler(async (event) => {
  const { ynabMock } = useRuntimeConfig()
  if (ynabMock) return resolveMockDebtSources()

  const user = await getSessionUser(event)
  const sources: DebtSource[] = []
  let liveError = false

  if (user) {
    for (const row of await listImportedPlans(user.id)) {
      const parsed = await kv.get<{ accounts?: ImportedAccount[] }>(importKey(user.id, row.id))
      sources.push({ planId: row.id, planName: `${row.name} (import)`, accounts: parsed?.accounts ?? [] })
    }
  }

  const pat = await resolvePat(event)
  if (pat) {
    const cacheKey = `debt-live:${user?.id ?? 'env'}`
    let live = await kv.get<DebtSource[]>(cacheKey)
    if (!live) {
      try {
        live = await fetchLiveDebtSources(pat)
        await kv.set(cacheKey, live, { ttl: LIVE_CACHE_TTL_SECONDS })
      } catch {
        liveError = true
      }
    }
    if (live) sources.push(...live)
  }

  return { sources, live_error: liveError }
})
