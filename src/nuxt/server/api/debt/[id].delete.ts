export default defineEventHandler(async (event) => {
  const owner = await requireDebtOwner(event)
  const id = getRouterParam(event, 'id')!
  const ok = await deleteDebt(owner, id)
  if (!ok) throw createError({ statusCode: 404, statusMessage: 'Debt not found' })
  return { ok: true }
})
