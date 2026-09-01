import type { Category, CategoryGroupWithCategories, MonthSummary, PlanSummary, ScheduledTransaction } from '#shared/types/ynab'

// Static fixtures served when NUXT_YNAB_MOCK is set, so the app can be
// developed and demoed without a YNAB token or any real account access.
// Four plans mirror a real household: three active + one archived that has
// no data for the current month. The mock "today" is Aug 2026.

const MOCK_CURRENT_MONTH = '2026-08-01'

const mockCategory = (
  id: string,
  groupId: string,
  groupName: string,
  name: string,
  budgeted: number,
  activity: number,
  balance: number,
  goal: Partial<Category> = {}
): Category => ({
  id,
  category_group_id: groupId,
  category_group_name: groupName,
  name,
  hidden: false,
  internal: false,
  budgeted,
  activity,
  balance,
  deleted: false,
  ...goal
})

const need = (target: number): Partial<Category> => ({ goal_type: 'NEED', goal_target: target })

const familyCategories: Category[] = [
  mockCategory('c-rent', 'g-bills', 'Bills', 'Rent', 1_850_000, -1_850_000, 0, need(1_850_000)),
  mockCategory('c-electric', 'g-bills', 'Bills', 'Electric', 120_000, -98_450, 21_550, need(120_000)),
  mockCategory('c-internet', 'g-bills', 'Bills', 'Internet', 80_000, -79_990, 10, need(80_000)),
  mockCategory('c-car-ins', 'g-bills', 'Bills', 'Car Insurance', 145_000, 0, 145_000, need(145_000)),

  mockCategory('c-cc', 'g-debt', 'Debt Payments', 'Credit Card', 400_000, -400_000, 0, need(400_000)),
  mockCategory('c-student', 'g-debt', 'Debt Payments', 'Student Loan', 350_000, -350_000, 0, need(350_000)),
  mockCategory('c-car', 'g-debt', 'Debt Payments', 'Car Loan', 285_000, -285_000, 0, need(285_000)),

  mockCategory('c-groceries', 'g-everyday', 'Everyday', 'Groceries', 700_000, -523_670, 176_330, need(700_000)),
  mockCategory('c-gas', 'g-everyday', 'Everyday', 'Gas', 160_000, -87_210, 72_790, need(160_000)),
  mockCategory('c-dining', 'g-everyday', 'Everyday', 'Dining Out', 200_000, -214_890, -14_890, need(200_000)),
  mockCategory('c-fun', 'g-everyday', 'Everyday', 'Fun Money', 150_000, -60_000, 90_000, need(150_000)),
  // No goal on purpose — categories without goals stay off the sandbox page.
  mockCategory('c-misc', 'g-everyday', 'Everyday', 'Misc', 50_000, -12_500, 37_500),

  // Yearly / non-monthly cadences: goal_target is the amount per period.
  mockCategory('c-registration', 'g-yearly', 'Yearly', 'Car Registration', 20_000, 0, 140_000, {
    goal_type: 'NEED', goal_target: 240_000, goal_cadence: 13, goal_cadence_frequency: 1, goal_target_date: '2027-03-15'
  }),
  mockCategory('c-prime', 'g-yearly', 'Yearly', 'Amazon Prime', 11_580, 0, 92_640, {
    goal_type: 'NEED', goal_target: 139_000, goal_cadence: 13, goal_cadence_frequency: 1
  }),
  mockCategory('c-water', 'g-yearly', 'Yearly', 'Water Bill', 30_000, -90_000, 60_000, {
    goal_type: 'NEED', goal_target: 90_000, goal_cadence: 4
  }),

  mockCategory('c-emergency', 'g-savings', 'Savings Goals', 'Emergency Fund', 200_000, 0, 2_400_000, {
    goal_type: 'TB', goal_target: 10_000_000, goal_percentage_complete: 24
  }),
  mockCategory('c-thanksgiving', 'g-savings', 'Savings Goals', 'Thanksgiving Trip', 150_000, 0, 450_000, {
    goal_type: 'TBD',
    goal_target: 1_200_000,
    goal_target_date: '2026-11-26',
    goal_percentage_complete: 37,
    goal_overall_funded: 450_000,
    goal_overall_left: 750_000
  }),
  mockCategory('c-christmas', 'g-savings', 'Savings Goals', 'Christmas', 100_000, 0, 500_000, {
    goal_type: 'TBD',
    goal_target: 1_500_000,
    goal_target_date: '2026-12-20',
    goal_percentage_complete: 33,
    goal_overall_funded: 500_000,
    goal_overall_left: 1_000_000
  }),

  mockCategory('c-inflow', 'g-internal', 'Internal Master Category', 'Inflow: Ready to Assign', 0, 6_500_000, 1_610_000, {
    internal: true
  })
]

const partnerCategories: Category[] = [
  mockCategory('p-phone', 'pg-bills', 'Bills', 'Phone', 65_000, -65_000, 0, need(65_000)),
  mockCategory('p-subs', 'pg-bills', 'Bills', 'Subscriptions', 40_000, -38_990, 1_010, need(40_000)),

  mockCategory('p-cc', 'pg-debt', 'Debt Payments', 'Partner Credit Card', 300_000, -300_000, 0, need(300_000)),
  mockCategory('p-medical', 'pg-debt', 'Debt Payments', 'Medical Bill', 150_000, -150_000, 0, need(150_000)),

  mockCategory('p-vacation', 'pg-savings', 'Savings', 'Vacation', 100_000, 0, 300_000, {
    goal_type: 'TBD',
    goal_target: 600_000,
    goal_target_date: '2026-10-15',
    goal_percentage_complete: 50,
    goal_overall_funded: 300_000,
    goal_overall_left: 300_000
  })
]

const businessCategories: Category[] = [
  mockCategory('b-software', 'bg-bills', 'Bills', 'Software', 120_000, -118_000, 2_000, need(120_000)),
  mockCategory('b-hosting', 'bg-bills', 'Bills', 'Hosting', 45_000, -45_000, 0, need(45_000)),
  mockCategory('b-taxes', 'bg-taxes', 'Taxes', 'Tax Set-Aside', 200_000, 0, 1_200_000, need(200_000))
]

const archivedCategories: Category[] = [
  mockCategory('a-rent', 'ag-bills', 'Bills', 'Old Apartment Rent', 1_400_000, 0, 0, need(1_400_000))
]

const monthRow = (month: string, income: number, budgeted: number, activity: number, tbb: number): MonthSummary =>
  ({ month, income, budgeted, activity, to_be_budgeted: tbb, deleted: false })

type MockPlanData = { plan: PlanSummary, months: MonthSummary[], categories: Category[], scheduled?: ScheduledTransaction[] }

// Bills and expected income for the calendar. date_first sits in early 2026 so
// every mock month (Jun–Sep 2026) gets occurrences; date_next reflects the
// first occurrence after the mock "today" (Aug 31 2026).
const familyScheduled: ScheduledTransaction[] = [
  {
    id: 's-rent', date_first: '2026-01-01', date_next: '2026-09-01', frequency: 'monthly',
    amount: -1_850_000, payee_name: '🏠 Hometown Property Mgmt', category_name: 'Rent', account_name: 'Joint Checking'
  },
  {
    id: 's-paycheck', date_first: '2026-01-03', date_next: '2026-09-03', frequency: 'twiceAMonth',
    amount: 2_800_000, payee_name: '💼 Acme Payroll', category_name: null, account_name: 'Joint Checking'
  },
  {
    id: 's-internet', date_first: '2026-01-05', date_next: '2026-09-05', frequency: 'monthly',
    amount: -80_000, payee_name: '📡 Fibre One Internet', category_name: 'Internet', account_name: 'Joint Checking'
  },
  {
    id: 's-electric', date_first: '2026-01-12', date_next: '2026-09-12', frequency: 'monthly',
    amount: -120_000, payee_name: '⚡ City Power & Light', category_name: 'Electric', account_name: 'Joint Checking'
  },
  {
    id: 's-rv-loan', date_first: '2026-01-15', date_next: '2026-09-15', frequency: 'monthly',
    amount: -204_290, payee_name: 'RV Loan', category_name: null, account_name: 'Joint Checking'
  },
  {
    id: 's-car-ins', date_first: '2026-01-18', date_next: '2026-09-18', frequency: 'monthly',
    amount: -145_000, payee_name: '🚗 Car Insurance', category_name: 'Car Insurance', account_name: 'Joint Checking'
  },
  {
    id: 's-truck-loan', date_first: '2026-01-20', date_next: '2026-09-20', frequency: 'monthly',
    amount: -310_000, payee_name: 'Truck Loan', category_name: null, account_name: 'Joint Checking'
  },
  {
    id: 's-water', date_first: '2026-02-25', date_next: '2026-11-25', frequency: 'every3Months',
    amount: -90_000, payee_name: '🚿 Water Bill', category_name: 'Water Bill', account_name: 'Joint Checking'
  }
]

const partnerScheduled: ScheduledTransaction[] = [
  {
    id: 'ps-phone', date_first: '2026-01-06', date_next: '2026-09-06', frequency: 'monthly',
    amount: -65_000, payee_name: '📱 Phone', category_name: 'Phone', account_name: 'Partner Checking'
  },
  {
    id: 'ps-paycheck', date_first: '2026-01-10', date_next: '2026-09-10', frequency: 'everyOtherWeek',
    amount: 950_000, payee_name: '💰 Paycheck — Mel', category_name: null, account_name: 'Partner Checking'
  }
]

const mockDb: Record<string, MockPlanData> = {
  'mock-plan-1': {
    plan: {
      id: 'mock-plan-1',
      name: 'Mock Family Budget',
      last_modified_on: '2026-08-28T12:00:00Z',
      currency_format: { iso_code: 'USD', currency_symbol: '$' }
    },
    months: [
      monthRow('2026-09-01', 0, 0, 0, 0),
      monthRow(MOCK_CURRENT_MONTH, 6_500_000, 4_890_000, -3_949_210, 1_610_000),
      monthRow('2026-07-01', 6_450_000, 4_890_000, -4_812_330, 45_000),
      monthRow('2026-06-01', 6_400_000, 4_890_000, -4_701_120, 20_000)
    ],
    categories: familyCategories,
    scheduled: familyScheduled
  },
  'mock-plan-2': {
    plan: {
      id: 'mock-plan-2',
      name: 'Mock Partner Budget',
      last_modified_on: '2026-08-27T09:00:00Z',
      currency_format: { iso_code: 'USD', currency_symbol: '$' }
    },
    months: [
      monthRow('2026-09-01', 0, 0, 0, 0),
      monthRow(MOCK_CURRENT_MONTH, 3_100_000, 655_000, -553_990, 210_000),
      monthRow('2026-07-01', 3_100_000, 655_000, -641_200, 95_000),
      monthRow('2026-06-01', 3_050_000, 655_000, -602_100, 60_000)
    ],
    categories: partnerCategories,
    scheduled: partnerScheduled
  },
  'mock-plan-3': {
    plan: {
      id: 'mock-plan-3',
      name: 'Mock Side Business',
      last_modified_on: '2026-08-20T16:00:00Z',
      currency_format: { iso_code: 'USD', currency_symbol: '$' }
    },
    months: [
      monthRow('2026-09-01', 0, 0, 0, 0),
      monthRow(MOCK_CURRENT_MONTH, 900_000, 365_000, -163_000, 480_000),
      monthRow('2026-07-01', 1_150_000, 365_000, -358_000, 620_000),
      monthRow('2026-06-01', 700_000, 365_000, -341_500, 210_000)
    ],
    categories: businessCategories
  },
  // Archived: no data for the current month — only old months exist.
  'mock-plan-4': {
    plan: {
      id: 'mock-plan-4',
      name: 'Mock 2019 Budget (Archived)',
      last_modified_on: '2026-01-05T10:00:00Z',
      currency_format: { iso_code: 'USD', currency_symbol: '$' }
    },
    months: [
      monthRow('2026-07-01', 0, 1_400_000, 0, 0),
      monthRow('2026-06-01', 0, 1_400_000, -1_400_000, 0)
    ],
    categories: archivedCategories
  }
}

function mockCategoryGroups (categories: Category[]): CategoryGroupWithCategories[] {
  const groups: CategoryGroupWithCategories[] = []
  const byId = new Map<string, CategoryGroupWithCategories>()
  for (const category of categories) {
    let group = byId.get(category.category_group_id)
    if (!group) {
      group = {
        id: category.category_group_id,
        name: category.category_group_name ?? 'Other',
        hidden: false,
        deleted: false,
        categories: []
      }
      byId.set(category.category_group_id, group)
      groups.push(group)
    }
    group.categories.push(category)
  }
  return groups
}

// ---- Mock debt histories (for the /debt page demo) -------------------------

const debtHistory = (startMonth: string, startBalance: number, monthlyPay: number, count: number) => {
  const history: Array<{ month: string, balance: number }> = []
  let [year, month] = startMonth.split('-').map(Number) as [number, number]
  let balance = startBalance
  for (let i = 0; i < count; i++) {
    history.push({ month: `${year}-${String(month).padStart(2, '0')}-01`, balance })
    balance = Math.min(balance + monthlyPay, 0)
    month++
    if (month > 12) { month = 1; year++ }
  }
  return history
}

export function resolveMockDebtRecords () {
  const rv = debtHistory('2024-06-01', -19_591_080, 105_000, 27)
  const sofi = debtHistory('2025-08-01', -30_000_000, 1_090_000, 13)
  const truck = debtHistory('2025-03-01', -11_000_000, 250_000, 18)
  const student = debtHistory('2021-09-01', -14_000_000, 291_667, 49)
  const record = (id: string, source: string, planName: string, name: string, extra: Record<string, unknown>) => ({
    id,
    source,
    planName,
    name,
    endDate: null,
    rate: null,
    minimumPayment: null,
    userStartDate: null,
    userStartBalance: null,
    userName: null,
    userBalance: null,
    userPaidIn: null,
    hidden: false,
    updatedAt: '2026-08-30T12:00:00Z',
    ...extra
  })
  return [
    record('mock-debt-1', 'ynab', 'Mock Family Budget', '🏦 SoFi Loan', {
      startDate: '2025-08-20', startBalance: -30_000_000, balance: sofi[sofi.length - 1]!.balance,
      paidIn: 1_090_000 * 12, history: sofi, rate: 8.49, minimumPayment: 1_364_580
    }),
    record('mock-debt-2', 'ynab', 'Mock Family Budget', '🚐 RV Loan', {
      startDate: '2024-06-15', startBalance: -19_591_080, balance: rv[rv.length - 1]!.balance,
      paidIn: 105_000 * 26, history: rv
    }),
    record('mock-debt-3', 'ynab', 'Mock Partner Budget', '🛻 Truck Loan', {
      startDate: '2025-03-03', startBalance: -11_000_000, balance: truck[truck.length - 1]!.balance,
      paidIn: 250_000 * 17, history: truck
    }),
    record('mock-debt-4', 'manual', '', '🎓 Old Student Loans', {
      startDate: '2021-09-01', endDate: '2025-09-01', startBalance: -14_000_000, balance: 0,
      paidIn: 14_000_000, history: student
    })
  ]
}


// ---- Mock register --------------------------------------------------------
// Seven months of believable history for the family budget, so recurring
// detection has patterns to find: exact monthly bills (gold), a drifting
// utility (payee+day), twice-monthly paychecks, and noisy groceries/coffee
// that should surface only as suggestions.

function mockTransactions (): { transactions: BudgetTransaction[], balance_now: number } {
  const txns: BudgetTransaction[] = []
  const push = (date: string, payee: string, amount: number, category: string | null = null, transfer = false) =>
    txns.push({ date, payee, amount, account: 'Joint Checking', category, transfer })
  const day = (m: number, d: number) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  // deterministic pseudo-noise so the fixture is stable across restarts
  let seed = 42
  const noise = (range: number) => {
    seed = (seed * 48271) % 2147483647
    return (seed % (2 * range + 1)) - range
  }

  for (let m = 2; m <= 8; m++) {
    push(day(m, 1), '🏠 Hometown Property Mgmt', -1_850_000, 'Rent')                          // gold: same day, same amount
    push(day(m, 5), '📡 Fibre One Internet', -79_990, 'Internet')                                 // gold
    push(day(m, 21), '🎵 Spotify', -11_990, 'Subscriptions')                                           // gold
    push(day(m, 12 + Math.max(-2, Math.min(2, noise(2)))), '⚡ City Power & Light', -(98_000 + noise(18) * 1000), 'Electric') // payee+day, amount drifts
    push(day(m, 3), '💼 Acme Payroll', 2_800_000, 'Inflow: Ready to Assign')
    push(day(m, 15), 'Transfer : 🚐 RV Loan', -204_290, null, true)          // one-sided: leaves the budget                                     // income, twice a month
    push(day(m, 18), '💼 Acme Payroll', 2_800_000, 'Inflow: Ready to Assign')
    // groceries: several a month, drifting day and amount — a suggestion, not a certainty
    const trips = 5 + (noise(1) + 1)
    for (let t = 0; t < trips; t++) {
      push(day(m, 2 + ((t * 5 + Math.abs(noise(2))) % 27)), '🛒 Green Basket Grocery', -(52_000 + Math.abs(noise(30)) * 1000), 'Groceries')
    }
    push(day(m, 6 + Math.abs(noise(3))), '☕ Cusp Coffee', -(6_000 + Math.abs(noise(3)) * 500), 'Dining Out')
    if (m % 3 === 0) push(day(m, 14), '🔧 Hardware Barn', -(34_000 + Math.abs(noise(20)) * 1000), 'Home Maintenance') // one-offs
  }
  txns.sort((a, b) => a.date.localeCompare(b.date))
  const net = txns.reduce((sum, t) => sum + t.amount, 0)
  // balance anchor: pretend the account started the window with a cushion
  return { transactions: txns, balance_now: net + 3_500_000 }
}

const MOCK_REGISTER = mockTransactions()

export function resolveYnabMock (path: string): unknown {
  if (path === '/plans') {
    return {
      plans: Object.values(mockDb).map(entry => entry.plan),
      default_plan: mockDb['mock-plan-1']!.plan
    }
  }

  const planMatch = path.match(/^\/plans\/([^/]+)/)
  const db = planMatch ? mockDb[planMatch[1]!] : undefined
  if (!db) {
    throw createError({ statusCode: 404, statusMessage: `No mock data for ${path}` })
  }

  if (/^\/plans\/[^/]+\/months$/.test(path)) {
    return { months: db.months }
  }

  const monthMatch = path.match(/^\/plans\/[^/]+\/months\/([^/]+)$/)
  if (monthMatch) {
    const key = monthMatch[1] === 'current' ? MOCK_CURRENT_MONTH : monthMatch[1]
    const summary = db.months.find(item => item.month === key)
    if (!summary) {
      throw createError({ statusCode: 404, statusMessage: `No mock data for month ${key}` })
    }
    return { month: { ...summary, categories: db.categories } }
  }

  if (/^\/plans\/[^/]+\/scheduled_transactions$/.test(path)) {
    return { scheduled_transactions: db.scheduled ?? [] }
  }

  if (/^\/plans\/[^/]+\/transactions$/.test(path)) {
    if (planMatch?.[1] === 'mock-plan-1') return MOCK_REGISTER
    return { transactions: [], balance_now: null }
  }

  if (/^\/plans\/[^/]+\/categories$/.test(path)) {
    return { category_groups: mockCategoryGroups(db.categories) }
  }

  throw createError({ statusCode: 404, statusMessage: `No mock data for ${path}` })
}
