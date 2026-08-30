import type { PlanSummary } from '#shared/types/ynab'

export default defineEventHandler(async () => {
  return await ynabFetch<{ plans: PlanSummary[], default_plan: PlanSummary | null }>('/plans')
})
