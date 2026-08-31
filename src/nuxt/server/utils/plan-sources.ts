import type { H3Event } from 'h3'
import type { MonthDetail, MonthSummary, PlanSummary } from '#shared/types/ynab'
import type { ParsedImport } from './ynab-import'

// Resolves which data backs a request, in priority order:
// 1. Mock fixtures (NUXT_YNAB_MOCK) — the public no-login demo
// 2. Imported plans (ids starting "imp_") — stored per user in KV
// 3. The YNAB API, authorized by the signed-in user's stored PAT, falling
//    back to the server's env PAT (personal single-user mode)

const IMPORT_PREFIX = 'imp_'
const isImportedPlanId = (planId: string) => planId.startsWith(IMPORT_PREFIX)
const importKey = (userId: string, planId: string) => `import:${userId}:${planId}`

export async function resolvePat (event: H3Event): Promise<string | null> {
  const user = await getSessionUser(event)
  if (user) {
    const dbUser = await getUserById(user.id)
    if (dbUser?.patCipher) {
      const pat = decryptSecret(dbUser.patCipher)
      if (pat) return pat
    }
  }
  const { ynabPersonalAccessToken } = useRuntimeConfig()
  return ynabPersonalAccessToken || null
}

export async function getPlansForRequest (event: H3Event): Promise<{
  plans: PlanSummary[]
  default_plan: PlanSummary | null
  pat_error: boolean
}> {
  const { ynabMock } = useRuntimeConfig()
  if (ynabMock) {
    return { ...resolveYnabMock('/plans') as { plans: PlanSummary[], default_plan: PlanSummary | null }, pat_error: false }
  }

  const plans: PlanSummary[] = []
  let defaultPlan: PlanSummary | null = null
  let patError = false

  const user = await getSessionUser(event)
  if (user) {
    for (const row of await listImportedPlans(user.id)) {
      plans.push({ id: row.id, name: `${row.name} (import)`, currency_format: { iso_code: 'USD', currency_symbol: '$' } })
    }
  }

  const pat = await resolvePat(event)
  if (pat) {
    try {
      const live = await ynabApi<{ plans: PlanSummary[], default_plan: PlanSummary | null }>(pat, '/plans')
      plans.push(...live.plans)
      defaultPlan = live.default_plan
    } catch {
      patError = true
    }
  }

  return { plans, default_plan: defaultPlan ?? plans[0] ?? null, pat_error: patError }
}

async function loadImport (event: H3Event, planId: string): Promise<ParsedImport> {
  const user = await requireUser(event)
  const parsed = await kv.get<ParsedImport>(importKey(user.id, planId))
  if (!parsed) throw createError({ statusCode: 404, statusMessage: 'Imported plan not found' })
  return parsed
}

export async function getMonthsForPlan (event: H3Event, planId: string): Promise<MonthSummary[]> {
  const { ynabMock } = useRuntimeConfig()
  if (ynabMock) {
    return (resolveYnabMock(`/plans/${planId}/months`) as { months: MonthSummary[] }).months
  }
  if (isImportedPlanId(planId)) {
    return importedMonthSummaries(await loadImport(event, planId))
  }
  const pat = await resolvePat(event)
  if (!pat) throw createError({ statusCode: 401, statusMessage: 'No YNAB token available' })
  const { months } = await ynabApi<{ months: MonthSummary[] }>(pat, `/plans/${planId}/months`)
  return months
}

export async function getMonthDetailForPlan (event: H3Event, planId: string, month: string): Promise<MonthDetail> {
  const { ynabMock } = useRuntimeConfig()
  if (ynabMock) {
    return (resolveYnabMock(`/plans/${planId}/months/${month}`) as { month: MonthDetail }).month
  }
  if (isImportedPlanId(planId)) {
    const detail = importedMonthDetail(await loadImport(event, planId), month)
    if (!detail) throw createError({ statusCode: 404, statusMessage: `No data for ${month}` })
    return detail
  }
  const pat = await resolvePat(event)
  if (!pat) throw createError({ statusCode: 401, statusMessage: 'No YNAB token available' })
  const detail = await ynabApi<{ month: MonthDetail }>(pat, `/plans/${planId}/months/${month}`)
  return detail.month
}

export { IMPORT_PREFIX, importKey }
