import type { Category, CategoryGroupWithCategories, MonthSummary, PlanSummary } from '#shared/types/ynab'

// Static fixtures served when NUXT_YNAB_MOCK is set, so the app can be
// developed and demoed without a YNAB token or any real account access.
// Every month returns the same category snapshot; the mock "today" is Aug 2026.

const MOCK_CURRENT_MONTH = '2026-08-01'

const mockPlan: PlanSummary = {
  id: 'mock-plan-1',
  name: 'Mock Family Budget',
  last_modified_on: '2026-08-28T12:00:00Z',
  currency_format: { iso_code: 'USD', currency_symbol: '$' }
}

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

const mockCategories: Category[] = [
  mockCategory('c-rent', 'g-bills', 'Bills', 'Rent', 1_850_000, -1_850_000, 0, {
    goal_type: 'NEED', goal_target: 1_850_000
  }),
  mockCategory('c-electric', 'g-bills', 'Bills', 'Electric', 120_000, -98_450, 21_550, {
    goal_type: 'NEED', goal_target: 120_000
  }),
  mockCategory('c-internet', 'g-bills', 'Bills', 'Internet', 80_000, -79_990, 10, {
    goal_type: 'NEED', goal_target: 80_000
  }),
  mockCategory('c-car-ins', 'g-bills', 'Bills', 'Car Insurance', 145_000, 0, 145_000, {
    goal_type: 'NEED', goal_target: 145_000
  }),

  mockCategory('c-cc', 'g-debt', 'Debt Payments', 'Credit Card', 400_000, -400_000, 0),
  mockCategory('c-student', 'g-debt', 'Debt Payments', 'Student Loan', 350_000, -350_000, 0),
  mockCategory('c-car', 'g-debt', 'Debt Payments', 'Car Loan', 285_000, -285_000, 0),

  mockCategory('c-groceries', 'g-everyday', 'Everyday', 'Groceries', 700_000, -523_670, 176_330),
  mockCategory('c-gas', 'g-everyday', 'Everyday', 'Gas', 160_000, -87_210, 72_790),
  mockCategory('c-dining', 'g-everyday', 'Everyday', 'Dining Out', 200_000, -214_890, -14_890),
  mockCategory('c-fun', 'g-everyday', 'Everyday', 'Fun Money', 150_000, -60_000, 90_000),

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

const mockMonths: MonthSummary[] = [
  { month: '2026-09-01', income: 0, budgeted: 0, activity: 0, to_be_budgeted: 0, deleted: false },
  { month: MOCK_CURRENT_MONTH, income: 6_500_000, budgeted: 4_890_000, activity: -3_949_210, to_be_budgeted: 1_610_000, deleted: false },
  { month: '2026-07-01', income: 6_450_000, budgeted: 4_890_000, activity: -4_812_330, to_be_budgeted: 45_000, deleted: false },
  { month: '2026-06-01', income: 6_400_000, budgeted: 4_890_000, activity: -4_701_120, to_be_budgeted: 20_000, deleted: false }
]

function mockCategoryGroups (): CategoryGroupWithCategories[] {
  const groups: CategoryGroupWithCategories[] = []
  const byId = new Map<string, CategoryGroupWithCategories>()
  for (const category of mockCategories) {
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

export function resolveYnabMock (path: string): unknown {
  if (path === '/plans') {
    return { plans: [mockPlan], default_plan: mockPlan }
  }

  if (/^\/plans\/[^/]+\/months$/.test(path)) {
    return { months: mockMonths }
  }

  const monthMatch = path.match(/^\/plans\/[^/]+\/months\/([^/]+)$/)
  if (monthMatch) {
    const key = monthMatch[1] === 'current' ? MOCK_CURRENT_MONTH : monthMatch[1]
    const summary = mockMonths.find(item => item.month === key)
    if (!summary) {
      throw createError({ statusCode: 404, statusMessage: `No mock data for month ${key}` })
    }
    return { month: { ...summary, categories: mockCategories } }
  }

  if (/^\/plans\/[^/]+\/categories$/.test(path)) {
    return { category_groups: mockCategoryGroups() }
  }

  throw createError({ statusCode: 404, statusMessage: `No mock data for ${path}` })
}
