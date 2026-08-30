export default defineEventHandler(async (event) => {
  const planId = getRouterParam(event, 'plan')
  return await ynabFetch(`/plans/${planId}/categories`)
})
