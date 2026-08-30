import type { MonthDetail } from '#shared/types/ynab'

export default defineEventHandler(async (event) => {
  const planId = getRouterParam(event, 'plan')
  const month = getRouterParam(event, 'month')
  return await ynabFetch<{ month: MonthDetail }>(`/plans/${planId}/months/${month}`)
})
