// The register window for one budget source, plus the balance anchor: what
// the on-budget accounts held at sync time (synced), the register net
// (imports — their register is complete history), or null (manual).
export default defineEventHandler(async (event) => {
  const planId = getRouterParam(event, 'plan')!
  return await getTransactionsForPlan(event, planId)
})
