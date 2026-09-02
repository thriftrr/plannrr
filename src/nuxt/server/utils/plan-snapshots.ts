import type { BudgetAccount, BudgetTransaction, Category, CurrencyFormat, MonthDetail, MonthSummary, ScheduledTransaction } from '#shared/types/ynab'

// ============================================================================
// Local-first plan snapshots.
//
// A budget source of any kind — synced from YNAB, imported from a zip, or
// created by hand — keeps its plan data HERE, in a KV snapshot. Pages read
// snapshots only; YNAB is touched exclusively by explicit sync actions.
// ============================================================================

export const SOURCE_PREFIX = 'src_'
export const isSourcePlanId = (planId: string) => planId.startsWith(SOURCE_PREFIX)

export interface PlanSnapshot {
  kind: 'synced' | 'imported' | 'manual'
  name: string
  currency: CurrencyFormat | null
  ynabPlanId?: string
  months: MonthSummary[]                 // newest-first summaries
  details: Record<string, MonthDetail>   // full categories (goals included) per month
  scheduled: ScheduledTransaction[]
  // Register window for recurring detection + the calendar's balance line.
  transactions?: BudgetTransaction[]
  // Sum of on-budget account balances at sync time. With it, the balance on
  // any recent day is balanceNow minus the transactions after that day — no
  // need for the full account history.
  accountBalanceNow?: number | null
  // The open on-budget accounts behind that sum, so the calendar can show
  // each one and let a person count or edit it.
  accounts?: BudgetAccount[]
  syncedAt?: string
}

export const snapshotKey = (owner: string, sourceId: string) => `source:${owner}:${sourceId}`

export async function loadSnapshot (owner: string, sourceId: string): Promise<PlanSnapshot | null> {
  return await kv.get<PlanSnapshot>(snapshotKey(owner, sourceId)) ?? null
}

export async function saveSnapshot (owner: string, sourceId: string, snapshot: PlanSnapshot): Promise<void> {
  await kv.set(snapshotKey(owner, sourceId), snapshot)
}

export async function deleteSnapshot (owner: string, sourceId: string): Promise<void> {
  try {
    await kv.del(snapshotKey(owner, sourceId))
  } catch { /* nothing to remove */ }
}

// How much history a synced snapshot carries. YNAB's month list goes back to
// the budget's birth; detail fetches are one API call per month, so keep the
// window tight enough to stay friendly with the 200-requests/hour budget.
const SNAPSHOT_MONTHS = 14

// Pulls one budget out of YNAB into snapshot form. Costs ~2 + min(months, 14)
// API calls; callers hold the sync throttle.
export async function snapshotYnabPlan (
  pat: string,
  plan: { id: string, name: string, currency_format?: CurrencyFormat | null }
): Promise<PlanSnapshot> {
  const { months } = await ynabApi<{ months: MonthSummary[] }>(pat, `/plans/${plan.id}/months`)
  const live = months
    .filter(month => !month.deleted)
    .sort((a, b) => b.month.localeCompare(a.month))
  const keep = live.slice(0, SNAPSHOT_MONTHS)

  const details: Record<string, MonthDetail> = {}
  for (const month of keep) {
    // Serial on purpose: a burst of parallel calls trips YNAB's rate limiter.
    const res = await ynabApi<{ month: MonthDetail }>(pat, `/plans/${plan.id}/months/${month.month}`)
    details[month.month] = res.month
  }

  let scheduled: ScheduledTransaction[] = []
  try {
    const res = await ynabApi<{ scheduled_transactions: ScheduledTransaction[] }>(
      pat, `/plans/${plan.id}/scheduled_transactions`
    )
    scheduled = res.scheduled_transactions.filter(txn => !txn.deleted)
  } catch { /* scheduled txns are enrichment — a failure shouldn't sink the sync */ }

  // The register window (recurring detection + balance line).
  let transactions: BudgetTransaction[] = []
  try {
    const since = new Date()
    since.setUTCMonth(since.getUTCMonth() - 15)
    const sinceKey = since.toISOString().slice(0, 10)
    type ApiTxn = {
      date: string, amount: number, payee_name?: string | null, account_name?: string | null,
      category_name?: string | null, transfer_account_id?: string | null, deleted?: boolean
    }
    const res = await ynabApi<{ transactions: ApiTxn[] }>(pat, `/plans/${plan.id}/transactions?since_date=${sinceKey}`)
    transactions = res.transactions
      .filter(txn => !txn.deleted)
      .map(txn => ({
        date: txn.date,
        payee: txn.payee_name ?? '',
        amount: txn.amount,
        account: txn.account_name ?? '',
        category: txn.category_name ?? null,
        transfer: Boolean(txn.transfer_account_id)
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-5000)
  } catch { /* detection simply has less to work with */ }

  // Live balance anchor: what the on-budget accounts hold right now.
  let accountBalanceNow: number | null = null
  let accounts: BudgetAccount[] = []
  try {
    type ApiAccount = { id: string, name: string, type: string, on_budget?: boolean, closed?: boolean, deleted?: boolean, balance: number }
    const res = await ynabApi<{ accounts: ApiAccount[] }>(pat, `/plans/${plan.id}/accounts`)
    accounts = res.accounts
      .filter(a => a.on_budget && !a.closed && !a.deleted)
      .map(a => ({ id: a.id, name: a.name, type: a.type, balance: a.balance }))
    accountBalanceNow = accounts.reduce((sum, a) => sum + a.balance, 0)
  } catch { /* the balance line falls back to net-of-register */ }

  return {
    kind: 'synced',
    name: plan.name,
    currency: plan.currency_format ?? null,
    ynabPlanId: plan.id,
    months: keep,
    details,
    scheduled,
    transactions,
    accountBalanceNow,
    accounts,
    syncedAt: new Date().toISOString()
  }
}

// A hand-built budget starts as one empty month; Tinkrr's groups and what-if
// rows do the rest. The current real month is appended at read time (below),
// so a manual budget never goes stale.
export function manualSnapshot (name: string, currency: CurrencyFormat): PlanSnapshot {
  const month = `${new Date().toISOString().slice(0, 7)}-01`
  return {
    kind: 'manual',
    name,
    currency,
    months: [emptyMonth(month)],
    details: { [month]: { ...emptyMonth(month), categories: [] } },
    scheduled: [],
    transactions: [],
    accountBalanceNow: null
  }
}

function emptyMonth (month: string): MonthSummary {
  return { month, income: 0, budgeted: 0, activity: 0, to_be_budgeted: 0, deleted: false }
}

// Read-side helpers -----------------------------------------------------------

export function snapshotMonths (snapshot: PlanSnapshot): MonthSummary[] {
  const months = [...snapshot.months]
  if (snapshot.kind === 'manual') {
    const current = `${new Date().toISOString().slice(0, 7)}-01`
    if (!months.some(m => m.month === current)) months.unshift(emptyMonth(current))
  }
  return months.sort((a, b) => b.month.localeCompare(a.month))
}

export function snapshotMonthDetail (snapshot: PlanSnapshot, month: string): MonthDetail | null {
  const detail = snapshot.details[month]
  if (detail) return detail
  if (snapshot.kind === 'manual') {
    // Any month a manual budget is asked for exists, empty.
    const categories: Category[] = []
    return { ...emptyMonth(month), categories }
  }
  return null
}
