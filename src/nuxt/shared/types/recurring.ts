// Recurring-transaction shapes, shared by the server's prefs store and the
// client's detection engine (app/utils/recurring-math.ts).

export type SeriesConfidence = 'gold' | 'strong' | 'maybe'
export type SeriesCadence = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly'

// A user-declared monthly transaction ("add monthly transactions" view).
export interface CustomMonthly {
  id: string
  name: string
  amount: number        // milliunits; negative = bill, positive = income
  day: number           // 1–31, clamped to month length when projecting
  kind: 'bill' | 'income'
}

// An account added by hand (sources without live YNAB accounts, or one YNAB
// doesn't know about). Credit balances are stored negative.
export interface ManualAccount {
  id: string
  name: string
  kind: 'cash' | 'credit'
  balance: number       // milliunits
}

// Cash-on-hand choices per source: which accounts count, balances typed over
// the synced ones, and hand-added accounts.
export interface AccountPrefs {
  excluded: string[]
  overrides: Record<string, number>
  manual: ManualAccount[]
}

export const emptyAccountPrefs = (): AccountPrefs => ({ excluded: [], overrides: {}, manual: [] })

// Per-source recurring preferences, stored server-side.
export interface RecurringPrefs {
  confirmed: string[]   // series keys the user promoted from suggestions
  dismissed: string[]   // series keys hidden even when detection is confident
  custom: CustomMonthly[]
  startingBalance: number | null // milliunits; balance seed when no register
  accounts?: AccountPrefs
}

// One recurring pattern found in a source's register.
// The user's confidence tiers:
//   gold    same payee + same amount + same day(s)-of-month
//   strong  same payee + same amount (day drifts) — tied with —
//           same payee + same day (amount drifts; most recent amount projects)
//   maybe   same payee with a rhythm but neither amount nor day stable —
//           charts only after the user adds it from the suggestions view
export interface DetectedSeries {
  key: string                 // stable across reloads: payee|discriminator|cadence
  payee: string               // display name (from the most recent occurrence)
  normalizedPayee: string
  confidence: SeriesConfidence
  cadence: SeriesCadence
  kind: 'bill' | 'income'
  amount: number              // milliunits to project — the most recent actual
  days: number[]              // day(s)-of-month for monthly/semimonthly; [] otherwise
  anchorDate: string          // most recent occurrence (projection starts after it)
  occurrences: number         // how many transactions back the detection
}
