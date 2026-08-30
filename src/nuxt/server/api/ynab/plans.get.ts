export type PlanSummary = {
  id: string
  name: string
  last_modified_on: string
  currency_format: { iso_code: string, currency_symbol: string } | null
}

export default defineEventHandler(async () => {
  return await ynabFetch<{ plans: PlanSummary[], default_plan: PlanSummary | null }>('/plans')
})
