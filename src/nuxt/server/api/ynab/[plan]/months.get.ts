import type { MonthSummary } from '#shared/types/ynab'

export default defineEventHandler(async (event) => {
  const planId = getRouterParam(event, 'plan')
  const { months } = await ynabFetch<{ months: MonthSummary[] }>(`/plans/${planId}/months`)
  return {
    months: months
      .filter(month => !month.deleted)
      .sort((a, b) => b.month.localeCompare(a.month))
  }
})
