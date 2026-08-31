import type { ImportedAccount } from './ynab-import'
import { nextMonthKey } from './ynab-import'

// Live debt sources via the YNAB API. Unlike exports, the API knows each
// loan's interest rate and minimum payment (LoanAccountPeriodicValue maps of
// date -> value; the latest entry is current), so those prefill the page's
// tweak inputs. Transactions are fetched over a bounded window and the
// rebuilt balance series is anchored to the account's real current balance,
// which keeps the math exact even when the window truncates early history.

export interface LiveDebtAccount extends ImportedAccount {
  rate?: number
  minimumPayment?: number
}

export interface DebtSource {
  planId: string
  planName: string
  accounts: LiveDebtAccount[]
}

interface ApiAccount {
  id: string
  name: string
  type: string
  closed: boolean
  deleted: boolean
  balance: number
  debt_interest_rates?: Record<string, number> | null
  debt_minimum_payments?: Record<string, number> | null
}

interface ApiTransaction {
  date: string
  amount: number
  payee_name?: string | null
  deleted?: boolean
}

const HISTORY_MONTHS = 24

function latestValue (map?: Record<string, number> | null): number | undefined {
  if (!map) return undefined
  const keys = Object.keys(map).sort()
  const last = keys[keys.length - 1]
  return last !== undefined ? map[last] : undefined
}

export function buildLiveAccount (account: ApiAccount, transactions: ApiTransaction[], endMonth: string): LiveDebtAccount {
  const txs = transactions
    .filter(tx => !tx.deleted)
    .sort((a, b) => a.date.localeCompare(b.date))

  const endOfMonth: Record<string, number> = {}
  let running = 0
  let paidIn = 0
  let startingBalanceTx: number | null = null
  for (const tx of txs) {
    running += tx.amount
    if (tx.payee_name === 'Starting Balance') startingBalanceTx = (startingBalanceTx ?? 0) + tx.amount
    else if (tx.amount > 0) paidIn += tx.amount
    endOfMonth[`${tx.date.slice(0, 7)}-01`] = running
  }

  // Anchor the series so it ends exactly at the account's real balance —
  // absorbs anything before the fetch window.
  const shift = account.balance - running

  const firstMonth = txs.length ? `${txs[0]!.date.slice(0, 7)}-01` : endMonth
  const history: LiveDebtAccount['history'] = []
  let carried = shift
  for (let key = firstMonth; key <= endMonth; key = nextMonthKey(key)) {
    if (key in endOfMonth) carried = endOfMonth[key]! + shift
    history.push({ month: key, balance: carried })
    if (history.length > 600) break
  }

  const rateRaw = latestValue(account.debt_interest_rates)
  const minimumPayment = latestValue(account.debt_minimum_payments)

  return {
    name: account.name,
    startDate: txs[0]?.date ?? `${endMonth.slice(0, 7)}-01`,
    startBalance: startingBalanceTx ?? history[0]?.balance ?? account.balance,
    balance: account.balance,
    paidIn,
    history,
    // Rates arrive in milliunits of a percent (8.49% -> 8490)
    rate: rateRaw !== undefined ? rateRaw / 1000 : undefined,
    minimumPayment
  }
}

export async function fetchLiveDebtSources (pat: string, planIds?: string[]): Promise<DebtSource[]> {
  const now = new Date()
  const endMonth = `${now.toISOString().slice(0, 7)}-01`
  const sinceDate = `${now.getUTCFullYear() - Math.ceil(HISTORY_MONTHS / 12)}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`

  const { plans } = await ynabApi<{ plans: Array<{ id: string, name: string }> }>(pat, '/plans')
  const selected = planIds ? plans.filter(plan => planIds.includes(plan.id)) : plans
  const sources: DebtSource[] = []

  for (const plan of selected) {
    const { accounts } = await ynabApi<{ accounts: ApiAccount[] }>(pat, `/plans/${plan.id}/accounts`)
    const debts = accounts.filter(account => !account.closed && !account.deleted && account.balance < 0)
    if (!debts.length) continue

    const built: LiveDebtAccount[] = []
    for (const account of debts) {
      const { transactions } = await ynabApi<{ transactions: ApiTransaction[] }>(
        pat,
        `/plans/${plan.id}/accounts/${account.id}/transactions?since_date=${sinceDate}`
      )
      built.push(buildLiveAccount(account, transactions, endMonth))
    }
    sources.push({ planId: plan.id, planName: plan.name, accounts: built })
  }

  return sources
}
