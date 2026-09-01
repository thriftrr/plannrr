// Shapes from the YNAB API (v1), trimmed to the fields YNABRR uses.
// https://api.ynab.com/ — all amounts are milliunits (1000 = $1.00)

export type CurrencyFormat = {
  iso_code: string
  currency_symbol: string
}

export type PlanSummary = {
  id: string
  name: string
  last_modified_on?: string
  currency_format?: CurrencyFormat | null
}

export type GoalType = 'TB' | 'TBD' | 'MF' | 'NEED' | 'DEBT' | null

export type Category = {
  id: string
  category_group_id: string
  category_group_name?: string
  name: string
  hidden: boolean
  internal?: boolean
  note?: string | null
  budgeted: number
  activity: number
  balance: number
  goal_type?: GoalType
  // Repeat cadence: 0 = none, 1 = monthly, 2 = weekly, 3-12 = every (n-1)
  // months, 13 = yearly, 14 = every 2 years; frequency multiplies 1/2/13.
  goal_cadence?: number | null
  goal_cadence_frequency?: number | null
  goal_target?: number | null
  goal_target_date?: string | null
  goal_percentage_complete?: number | null
  goal_overall_funded?: number | null
  goal_overall_left?: number | null
  deleted?: boolean
}

export type CategoryGroupWithCategories = {
  id: string
  name: string
  hidden: boolean
  deleted?: boolean
  categories: Category[]
}

export type MonthSummary = {
  month: string // ISO date, always the first of the month
  note?: string | null
  income: number
  budgeted: number
  activity: number
  to_be_budgeted: number
  deleted?: boolean
}

export type MonthDetail = MonthSummary & {
  categories: Category[]
}

// Scheduled transactions (bills & expected income). Amounts are milliunits;
// negative = outflow (a bill), positive = inflow (income).
export type ScheduledFrequency =
  | 'never' | 'daily' | 'weekly' | 'everyOtherWeek' | 'twiceAMonth'
  | 'every4Weeks' | 'monthly' | 'everyOtherMonth' | 'every3Months'
  | 'every4Months' | 'twiceAYear' | 'yearly' | 'everyOtherYear'

export type ScheduledTransaction = {
  id: string
  date_first: string
  date_next: string
  frequency: ScheduledFrequency
  amount: number
  payee_name?: string | null
  category_name?: string | null
  account_name?: string | null
  transfer_account_id?: string | null
  deleted?: boolean
}

// One register row, normalized across sources (zip register or the API).
// amount is milliunits, negative = outflow. `transfer` rows move money between
// accounts — they net to zero for balances and are ignored by recurring
// detection.
export type BudgetTransaction = {
  date: string          // ISO YYYY-MM-DD
  payee: string
  amount: number
  account: string
  category?: string | null
  transfer?: boolean
}
