import type { Category, CategoryGroupWithCategories, MonthSummary, PlanSummary } from '#shared/types/ynab'

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

type MockPlanData = { plan: PlanSummary, months: MonthSummary[], categories: Category[] }

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
    categories: familyCategories
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
    categories: partnerCategories
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

  if (/^\/plans\/[^/]+\/categories$/.test(path)) {
    return { category_groups: mockCategoryGroups(db.categories) }
  }

  throw createError({ statusCode: 404, statusMessage: `No mock data for ${path}` })
}
