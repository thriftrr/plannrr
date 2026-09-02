import type { Category } from '#shared/types/ynab'

// ---- Goal math ------------------------------------------------------------
// Every row shows a true MONTHLY cost, whatever the goal's period:
// - Repeating goals amortize over their cadence: $600 yearly = $50/mo,
//   $90 every 3 months = $30/mo, weekly goals scale by 52/12
// - Save-by-date goals (TB/TBD): remaining amount spread over months left,
//   a transparent pace rather than YNAB's exact on-track math
// - TB with no date: no defined pace, so fall back to what's assigned today
//
// Shared by Tinkrr (the per-category table) and Home (the "left over this
// month" tile) so the two can never disagree.

// Rows that belong on a goal-driven surface: visible, real, and carrying a
// goal — Home's tiles and Calendrr.
export function isGoalCategory (category: Category): boolean {
  return isPlannableCategory(category) && Boolean(category.goal_type)
}

// Every category a person can plan with — goal or not. Tinkrr lists all of
// these (a target can be drafted onto any of them); Home's tiles only count
// the ones that already carry a goal.
export function isPlannableCategory (category: Category): boolean {
  if (category.hidden || category.deleted || category.internal) return false
  const group = category.category_group_name ?? 'Other'
  return group !== 'Internal Master Category' && group !== 'Hidden Categories'
}

export const roundToCent = (milliunits: number) => Math.round(milliunits / 10) * 10

export function monthsUntil (from: string, to: string) {
  const [fromYear, fromMonth] = from.split('-').map(Number)
  const [toYear, toMonth] = to.split('-').map(Number)
  return Math.max((toYear! - fromYear!) * 12 + (toMonth! - fromMonth!) + 1, 1)
}

export function goalMonthlyFor (category: Category, month: string): number {
  if (!category.goal_type) return 0

  const target = category.goal_target ?? 0
  const cadence = category.goal_cadence
  const frequency = Math.max(category.goal_cadence_frequency ?? 1, 1)

  // Repeating goals: goal_target is the amount per period — amortize it.
  if (cadence != null && cadence !== 0) {
    if (cadence === 1) return roundToCent(target / frequency)
    if (cadence === 2) return roundToCent((target * 52) / frequency / 12)
    if (cadence >= 3 && cadence <= 12) return roundToCent(target / (cadence - 1))
    if (cadence === 13) return roundToCent(target / (12 * frequency))
    if (cadence === 14) return roundToCent(target / 24)
  }

  // One-time save-by-date goals: pace over the months left.
  if (category.goal_target_date) {
    const remaining = category.goal_overall_left
      ?? Math.max(target - (category.goal_overall_funded ?? 0), 0)
    const months = monthsUntil(month || category.goal_target_date, category.goal_target_date)
    return Math.max(roundToCent(remaining / months), 0)
  }

  if (category.goal_type === 'TB') return category.budgeted

  // MF / DEBT / undated NEED: the target is already a monthly amount.
  return target
}

// A goal counts as "due this month" when it's anchored to a target date that
// lands inside the given month — what Calendrr will chart, and what Home
// counts for its bills-due tile.
export function isDueInMonth (category: Category, month: string): boolean {
  if (!category.goal_target_date || !month) return false
  return category.goal_target_date.slice(0, 7) === month.slice(0, 7)
}
