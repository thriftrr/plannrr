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
