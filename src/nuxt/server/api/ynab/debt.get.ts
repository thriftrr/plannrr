import type { ImportedAccount } from '../../utils/ynab-import'

// Debt histories come from imported plans (reconstructed from each export's
// Register). Mock mode serves fixtures so the demo works without an account.
export default defineEventHandler(async (event) => {
  const { ynabMock } = useRuntimeConfig()
  if (ynabMock) return resolveMockDebtSources()

  const user = await getSessionUser(event)
  if (!user) return { sources: [] }

  const sources: Array<{ planId: string, planName: string, accounts: ImportedAccount[] }> = []
  for (const row of await listImportedPlans(user.id)) {
    const parsed = await kv.get<{ accounts?: ImportedAccount[] }>(importKey(user.id, row.id))
    sources.push({ planId: row.id, planName: row.name, accounts: parsed?.accounts ?? [] })
  }
  return { sources }
})
