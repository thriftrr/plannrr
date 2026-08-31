export default defineEventHandler(async (event) => {
  const planId = getRouterParam(event, 'plan')!
  const months = await getMonthsForPlan(event, planId)
  return {
    months: months
      .filter(month => !month.deleted)
      .sort((a, b) => b.month.localeCompare(a.month))
  }
})
