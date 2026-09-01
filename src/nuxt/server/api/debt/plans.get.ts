// The budgets a debt sync could pull from: synced sources (by their YNAB plan
// id — the sync fetches accounts live from YNAB on demand) plus zip imports.
export default defineEventHandler(async (event) => {
  const owner = await debtOwner(event)
  if (!owner) return { plans: [] }

  const plans: Array<{ id: string, name: string, kind: 'live' | 'import' }> = []
  for (const row of await listPlanSources(owner)) {
    if (row.kind === 'synced' && row.ynabPlanId) {
      plans.push({ id: row.ynabPlanId, name: row.name, kind: 'live' })
    } else if (row.kind === 'imported') {
      plans.push({ id: row.id, name: `${row.name} (import)`, kind: 'import' })
    }
  }
  return { plans }
})
