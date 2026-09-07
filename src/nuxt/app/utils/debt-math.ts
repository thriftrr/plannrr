// Amortization projection for the debt burndown. All amounts in milliunits;
// balances are positive magnitudes here.

export interface PayoffProjection {
  months: string[]
  balances: number[]
  payoffMonth: string | null
  interestTotal: number
  paidTotal: number
}

export function nextDebtMonth (key: string): string {
  const [year, month] = key.split('-').map(Number)
  return month === 12 ? `${year! + 1}-01-01` : `${year}-${String(month! + 1).padStart(2, '0')}-01`
}

export function addDebtMonths (key: string, count: number): string {
  const [year, month] = key.split('-').map(Number)
  const index = year! * 12 + (month! - 1) + count
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`
}

// What kind of windfall a lump is. Purely descriptive except for 'boost',
// which is a temporary monthly top-up (extra $X every month for N months)
// rather than a dated lump — modelled as `every: 1`.
export type LumpKind = 'bonus' | 'refund' | 'gift' | 'sale' | 'boost' | 'other'
export const LUMP_KINDS: LumpKind[] = ['bonus', 'refund', 'gift', 'sale', 'boost', 'other']

// A dated lump sum on top of the monthly plan — a bonus, a tax refund, a
// gift. `every` > 0 repeats it that many months apart; `times` caps how many
// hits (0 = keeps going). `loanId` aims it at one loan; null lets it follow
// the strategy's order like any other surplus.
export interface LumpPayment {
  id: string
  kind: LumpKind
  label: string
  month: string
  amount: number
  every: number
  times: number
  loanId: string | null
}

// One concrete hit of a lump payment: which month, how much, aimed where.
export interface LumpHit {
  month: string
  amount: number
  loanId: string | null
  kind: LumpKind
}

// Unroll repeating lumps into concrete hits on or after `fromMonth`, out to
// the projection horizon. Occurrences before `fromMonth` still count toward
// `times` — a bonus that started last year has used some of its hits.
export function expandLumpPayments (lumps: LumpPayment[], fromMonth: string, capMonths = 600): LumpHit[] {
  const hits: LumpHit[] = []
  if (!fromMonth) return hits
  const horizon = addDebtMonths(fromMonth, capMonths)
  for (const lump of lumps) {
    if (!/^\d{4}-\d{2}-01$/.test(lump.month) || lump.amount <= 0) continue
    const every = Math.max(Math.floor(lump.every), 0)
    const times = Math.max(Math.floor(lump.times), 0)
    for (let k = 0; ; k++) {
      if (times && k >= times) break
      const month = every ? addDebtMonths(lump.month, k * every) : lump.month
      if (month >= horizon) break
      if (month >= fromMonth) hits.push({ month, amount: lump.amount, loanId: lump.loanId, kind: lump.kind })
      if (!every) break
    }
  }
  return hits.sort((a, b) => a.month.localeCompare(b.month))
}

export interface SnowballLoanInput {
  id: string
  balance: number
  annualRatePct: number
  minimum: number
  extraFirstMonth?: number
}

export interface SnowballResult {
  perLoan: Record<string, PayoffProjection>
  debtFree: string | null
  interestTotal: number
}

// The one projection engine. With `rollover` (the default) it's the debt
// snowball: every month the budget is the sum of ALL minimums (paid-off
// loans keep contributing theirs — that's the snowball rolling) plus the
// pool (snowball + extra). Minimums are paid first, then the remainder
// cascades down the target order until it's spent.
//
// With `rollover: false` it's plain minimum payments: each loan pays only
// its own monthly and nothing rolls forward — only lump payments (and the
// pool, if any) cascade down the order.
export function projectSnowball (options: {
  loans: SnowballLoanInput[]
  pool: number
  order: 'balance' | 'rate' | 'given'
  fromMonth: string
  lumps?: LumpHit[]
  rollover?: boolean
  capMonths?: number
}): SnowballResult {
  const cap = options.capMonths ?? 600
  const rollover = options.rollover ?? true
  const lumps = options.lumps ?? []
  const ordered = options.order === 'given'
    ? [...options.loans]
    : [...options.loans].sort((a, b) => options.order === 'rate'
      ? (b.annualRatePct - a.annualRatePct) || (a.balance - b.balance)
      : (a.balance - b.balance))

  const state = new Map(ordered.map(loan => [loan.id, {
    balance: Math.max(loan.balance, 0),
    interest: 0,
    paid: 0,
    months: [] as string[],
    balances: [] as number[],
    payoff: null as string | null,
    // Minimum-only mode: a loan whose payment can't cover its interest and
    // that no lump will ever reach is frozen where it stands rather than
    // projected forever upward.
    frozen: false
  }]))

  const minSum = options.loans.reduce((sum, loan) => sum + Math.max(loan.minimum, 0), 0)
  const pool = Math.max(options.pool, 0)
  const lumpMayReach = (id: string, key: string) =>
    lumps.some(hit => hit.month >= key && (hit.loanId === null || hit.loanId === id || !state.has(hit.loanId)))
  let key = options.fromMonth
  let debtFree: string | null = null
  const totals: number[] = []
  let stall = 0

  for (let i = 0; i < cap; i++) {
    const extraSum = i === 0
      ? options.loans.reduce((sum, loan) => sum + Math.max(loan.extraFirstMonth ?? 0, 0), 0)
      : 0
    const hits = lumps.filter(hit => hit.month === key)

    for (const loan of ordered) {
      const slot = state.get(loan.id)!
      if (slot.balance <= 0 || slot.frozen) continue
      const interest = Math.round(slot.balance * Math.max(loan.annualRatePct, 0) / 100 / 12)
      const due = Math.max(loan.minimum, 0) + (i === 0 ? Math.max(loan.extraFirstMonth ?? 0, 0) : 0)
      if (!rollover && !pool && due <= interest && !lumpMayReach(loan.id, key)) {
        slot.frozen = true
        continue
      }
      slot.balance += interest
      slot.interest += interest
    }

    let budget = rollover
      ? minSum + pool + extraSum
      : ordered.reduce((sum, loan) => {
        const slot = state.get(loan.id)!
        return slot.balance > 0 && !slot.frozen ? sum + Math.max(loan.minimum, 0) : sum
      }, 0) + pool + extraSum

    // Minimums first (plus any earmarked one-time extra in the first month)
    for (const loan of ordered) {
      const slot = state.get(loan.id)!
      if (slot.balance <= 0 || slot.frozen) continue
      const floor = Math.max(loan.minimum, 0) + (i === 0 ? Math.max(loan.extraFirstMonth ?? 0, 0) : 0)
      const pay = Math.min(floor, slot.balance, budget)
      slot.balance -= pay
      slot.paid += pay
      // Without rollover a final short payment doesn't free up cash for
      // anyone else — the loan simply closes.
      budget -= rollover ? pay : Math.min(floor, budget)
    }

    // Lump sums: aimed ones hit their loan directly, and whatever they can't
    // use (or ones aimed at a loan that's gone) joins the cascade below.
    for (const hit of hits) {
      const slot = hit.loanId ? state.get(hit.loanId) : undefined
      const amount = Math.max(hit.amount, 0)
      if (slot && slot.balance > 0 && !slot.frozen) {
        const pay = Math.min(amount, slot.balance)
        slot.balance -= pay
        slot.paid += pay
        budget += amount - pay
      } else {
        budget += amount
      }
    }

    // Waterfall the rest down the target order
    for (const loan of ordered) {
      if (budget <= 0) break
      const slot = state.get(loan.id)!
      if (slot.balance <= 0 || slot.frozen) continue
      const pay = Math.min(budget, slot.balance)
      slot.balance -= pay
      slot.paid += pay
      budget -= pay
    }

    let total = 0
    for (const loan of ordered) {
      const slot = state.get(loan.id)!
      if (slot.frozen) continue
      slot.months.push(key)
      slot.balances.push(slot.balance)
      if (slot.balance <= 0 && !slot.payoff) slot.payoff = key
      total += slot.balance
    }
    totals.push(total)

    if (total <= 0) {
      if ([...state.values()].every(slot => !slot.frozen)) debtFree = key
      break
    }

    // Stall detection. Without lumps, two months of no progress means the
    // payments don't amortize. With lumps the picture is lumpy on purpose
    // — a quarterly bonus is what makes progress — so compare year over year.
    if (lumps.length) {
      if (i >= 12 && total >= totals[i - 12]!) break
    } else if (i > 0 && total >= totals[i - 1]!) {
      stall++
      if (stall >= 2) break
    } else {
      stall = 0
    }
    key = nextDebtMonth(key)
  }

  const perLoan: Record<string, PayoffProjection> = {}
  let interestTotal = 0
  for (const loan of ordered) {
    const slot = state.get(loan.id)!
    interestTotal += slot.interest
    perLoan[loan.id] = {
      months: slot.months,
      balances: slot.balances,
      payoffMonth: slot.payoff,
      interestTotal: slot.interest,
      paidTotal: slot.paid
    }
  }

  return { perLoan, debtFree, interestTotal }
}
