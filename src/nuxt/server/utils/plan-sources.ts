import type { H3Event } from 'h3'
import type { BudgetAccount, BudgetTransaction, MonthDetail, MonthSummary, PlanSummary, ScheduledTransaction } from '#shared/types/ynab'
import type { ParsedImport } from './ynab-import'

// ============================================================================
// Resolves which data backs a request. LOCAL-FIRST: pages never touch YNAB.
//
// 1. Mock fixtures (NUXT_YNAB_MOCK) — the public no-login demo
// 2. Snapshot sources ("src_" ids) — synced, imported, or manual budgets,
//    stored locally; YNAB is only reached by explicit sync actions
// 3. Legacy zip imports ("imp_" ids) — the pre-sources import format
// ============================================================================

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
  // The env PAT is a dev/personal-mode convenience ONLY. In production it must
  // never back an arbitrary session — that would hand every signed-in user
  // (and their sync/push actions) the operator's own YNAB account.
  if (!import.meta.dev) return null
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

  const owner = await debtOwner(event)
  if (!owner) return { plans: [], default_plan: null, pat_error: false }

  const plans: PlanSummary[] = []
  let defaultPlan: PlanSummary | null = null

  for (const row of await listPlanSources(owner)) {
    const summary: PlanSummary = {
      id: row.id,
      name: row.kind === 'imported' ? `${row.name} (import)` : row.name,
      currency_format: { iso_code: row.currencyCode || 'USD', currency_symbol: '$' }
    }
    plans.push(summary)
    // The first synced budget is the most natural default.
    if (!defaultPlan && row.kind === 'synced') defaultPlan = summary
  }

  return { plans, default_plan: defaultPlan ?? plans[0] ?? null, pat_error: false }
}

async function loadImport (event: H3Event, planId: string): Promise<ParsedImport> {
  const user = await requireUser(event)
  const parsed = await kv.get<ParsedImport>(importKey(user.id, planId))
  if (!parsed) throw createError({ statusCode: 404, statusMessage: 'Imported plan not found' })
  return parsed
}

async function loadSourceSnapshot (event: H3Event, sourceId: string) {
  const owner = await debtOwner(event)
  if (!owner) throw createError({ statusCode: 401, statusMessage: 'Sign in required' })
  const snapshot = await loadSnapshot(owner, sourceId)
  if (!snapshot) throw createError({ statusCode: 404, statusMessage: 'Budget source not found' })
  return snapshot
}

export async function getMonthsForPlan (event: H3Event, planId: string): Promise<MonthSummary[]> {
  const { ynabMock } = useRuntimeConfig()
  if (ynabMock) {
    return (resolveYnabMock(`/plans/${planId}/months`) as { months: MonthSummary[] }).months
  }
  if (isSourcePlanId(planId)) {
    return snapshotMonths(await loadSourceSnapshot(event, planId))
  }
  if (isImportedPlanId(planId)) {
    return importedMonthSummaries(await loadImport(event, planId))
  }
  throw createError({ statusCode: 404, statusMessage: 'Unknown budget source — re-sync from the Account page' })
}

export async function getMonthDetailForPlan (event: H3Event, planId: string, month: string): Promise<MonthDetail> {
  const { ynabMock } = useRuntimeConfig()
  if (ynabMock) {
    return (resolveYnabMock(`/plans/${planId}/months/${month}`) as { month: MonthDetail }).month
  }
  if (isSourcePlanId(planId)) {
    const detail = snapshotMonthDetail(await loadSourceSnapshot(event, planId), month)
    if (!detail) throw createError({ statusCode: 404, statusMessage: `No data for ${month}` })
    return detail
  }
  if (isImportedPlanId(planId)) {
    const detail = importedMonthDetail(await loadImport(event, planId), month)
    if (!detail) throw createError({ statusCode: 404, statusMessage: `No data for ${month}` })
    return detail
  }
  throw createError({ statusCode: 404, statusMessage: 'Unknown budget source — re-sync from the Account page' })
}

export async function getScheduledForPlan (event: H3Event, planId: string): Promise<ScheduledTransaction[]> {
  const { ynabMock } = useRuntimeConfig()
  if (ynabMock) {
    const res = resolveYnabMock(`/plans/${planId}/scheduled_transactions`) as { scheduled_transactions?: ScheduledTransaction[] }
    return (res.scheduled_transactions ?? []).filter(txn => !txn.deleted)
  }
  if (isSourcePlanId(planId)) {
    return (await loadSourceSnapshot(event, planId)).scheduled
  }
  // Legacy zip imports carry no schedule.
  return []
}

export async function getTransactionsForPlan (event: H3Event, planId: string): Promise<{
  transactions: BudgetTransaction[]
  balance_now: number | null
  accounts: BudgetAccount[]
}> {
  const { ynabMock } = useRuntimeConfig()
  if (ynabMock) {
    const res = resolveYnabMock(`/plans/${planId}/transactions`) as { transactions?: BudgetTransaction[], balance_now?: number | null, accounts?: BudgetAccount[] }
    return { transactions: res.transactions ?? [], balance_now: res.balance_now ?? null, accounts: res.accounts ?? [] }
  }
  if (isSourcePlanId(planId)) {
    const snapshot = await loadSourceSnapshot(event, planId)
    return { transactions: snapshot.transactions ?? [], balance_now: snapshot.accountBalanceNow ?? null, accounts: snapshot.accounts ?? [] }
  }
  if (isImportedPlanId(planId)) {
    const parsed = await loadImport(event, planId)
    // Zip registers are complete history, so their net IS the balance.
    const transactions = parsed.transactions ?? []
    const balance = transactions.length ? transactions.reduce((sum, txn) => sum + txn.amount, 0) : null
    return { transactions, balance_now: balance, accounts: [] }
  }
  return { transactions: [], balance_now: null, accounts: [] }
}

export { IMPORT_PREFIX, importKey }
