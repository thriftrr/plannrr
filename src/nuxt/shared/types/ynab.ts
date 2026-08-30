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
