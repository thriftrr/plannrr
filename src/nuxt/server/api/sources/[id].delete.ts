// Removes a budget source AND the debt rows it produced (the user's choice:
// "delete everything from that source"). The client confirms first, showing
// the debt count from GET /api/sources.
export default defineEventHandler(async (event) => {
  const owner = await requireDebtOwner(event)
  const id = getRouterParam(event, 'id')!

  const row = await getPlanSource(owner, id)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Budget source not found' })

  let debtsDeleted = 0
  if (row.kind === 'synced' && row.ynabPlanId) {
    debtsDeleted = await deleteDebtsFromSource(owner, 'ynab', row.ynabPlanId)
  } else if (row.kind === 'imported') {
    debtsDeleted = await deleteDebtsFromSource(owner, 'import', row.id)
    const user = await getSessionUser(event)
    if (user) {
      try {
        await kv.del(importKey(user.id, row.id))
      } catch { /* snapshot already gone */ }
    }
  }
  await deleteSnapshot(owner, row.id)
  await deletePlanSource(owner, row.id)

  return { ok: true, debtsDeleted }
})
