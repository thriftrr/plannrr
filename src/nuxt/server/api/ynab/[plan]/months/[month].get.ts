export default defineEventHandler(async (event) => {
  const planId = getRouterParam(event, 'plan')!
  const month = getRouterParam(event, 'month')!
  return { month: await getMonthDetailForPlan(event, planId, month) }
})
