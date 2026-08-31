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

// Debt snowball with rollover: every month the budget is the sum of ALL
// minimums (paid-off loans keep contributing theirs — that's the snowball
// rolling) plus the pool (snowball + extra). Minimums are paid first, then
// the remainder cascades down the target order until it's spent.
export function projectSnowball (options: {
  loans: SnowballLoanInput[]
  pool: number
  order: 'balance' | 'rate' | 'given'
  fromMonth: string
  capMonths?: number
}): SnowballResult {
  const cap = options.capMonths ?? 600
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
    payoff: null as string | null
  }]))

  const minSum = options.loans.reduce((sum, loan) => sum + Math.max(loan.minimum, 0), 0)
  let key = options.fromMonth
  let debtFree: string | null = null
  let prevTotal = Number.POSITIVE_INFINITY
  let stall = 0

  for (let i = 0; i < cap; i++) {
    const extraSum = i === 0
      ? options.loans.reduce((sum, loan) => sum + Math.max(loan.extraFirstMonth ?? 0, 0), 0)
      : 0
    let budget = minSum + Math.max(options.pool, 0) + extraSum

    for (const loan of ordered) {
      const slot = state.get(loan.id)!
      if (slot.balance <= 0) continue
      const interest = Math.round(slot.balance * Math.max(loan.annualRatePct, 0) / 100 / 12)
      slot.balance += interest
      slot.interest += interest
    }

    // Minimums first (plus any earmarked one-time extra in the first month)
    for (const loan of ordered) {
      const slot = state.get(loan.id)!
      if (slot.balance <= 0) continue
      const floor = Math.max(loan.minimum, 0) + (i === 0 ? Math.max(loan.extraFirstMonth ?? 0, 0) : 0)
      const pay = Math.min(floor, slot.balance, budget)
      slot.balance -= pay
      slot.paid += pay
      budget -= pay
    }

    // Waterfall the rest down the target order
    for (const loan of ordered) {
      if (budget <= 0) break
      const slot = state.get(loan.id)!
      if (slot.balance <= 0) continue
      const pay = Math.min(budget, slot.balance)
      slot.balance -= pay
      slot.paid += pay
      budget -= pay
    }

    let total = 0
    for (const loan of ordered) {
      const slot = state.get(loan.id)!
      slot.months.push(key)
      slot.balances.push(slot.balance)
      if (slot.balance <= 0 && !slot.payoff) slot.payoff = key
      total += slot.balance
    }

    if (total <= 0) {
      debtFree = key
      break
    }
    if (total >= prevTotal) {
      stall++
      if (stall >= 2) break
    } else {
      stall = 0
    }
    prevTotal = total
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

export function projectPayoff (options: {
  balance: number
  annualRatePct: number
  payment: number
  fromMonth: string
  extra?: { month: string, amount: number }
  capMonths?: number
}): PayoffProjection {
  const cap = options.capMonths ?? 600
  const monthlyRate = Math.max(options.annualRatePct, 0) / 100 / 12
  const months: string[] = []
  const balances: number[] = []
  let balance = Math.max(options.balance, 0)
  let interestTotal = 0
  let paidTotal = 0
  let payoffMonth: string | null = null
  let key = options.fromMonth

  for (let i = 0; i < cap && balance > 0; i++) {
    const interest = Math.round(balance * monthlyRate)
    const extra = options.extra?.month === key ? Math.max(options.extra.amount, 0) : 0
    const due = Math.max(options.payment, 0) + extra
    // A payment that doesn't cover interest never amortizes — bail out
    // instead of projecting forever upward.
    if (due <= interest && !extra) {
      return { months, balances, payoffMonth: null, interestTotal, paidTotal }
    }
    balance += interest
    interestTotal += interest
    const paid = Math.min(due, balance)
    paidTotal += paid
    balance -= paid
    months.push(key)
    balances.push(balance)
    if (balance <= 0) payoffMonth = key
    key = nextDebtMonth(key)
  }

  return { months, balances, payoffMonth, interestTotal, paidTotal }
}
