// The budgets a sync could pull from: live YNAB plans (via PAT) + imports.
export default defineEventHandler(async (event) => {
  const owner = await debtOwner(event)
  if (!owner) return { plans: [] }

  const plans: Array<{ id: string, name: string, kind: 'live' | 'import' }> = []

  const user = await getSessionUser(event)
  if (user) {
    for (const row of await listImportedPlans(user.id)) {
      plans.push({ id: row.id, name: `${row.name} (import)`, kind: 'import' })
    }
  }

  const pat = await resolvePat(event)
  if (pat) {
    try {
      const live = await ynabApi<{ plans: Array<{ id: string, name: string }> }>(pat, '/plans')
      for (const plan of live.plans) plans.push({ id: plan.id, name: plan.name, kind: 'live' })
    } catch { /* token problems surface on sync */ }
  }

  return { plans }
})
