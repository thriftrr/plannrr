export default defineEventHandler(async (event) => {
  const planId = getRouterParam(event, 'plan')!
  return { scheduled_transactions: await getScheduledForPlan(event, planId) }
})
