import type { ScheduledTransaction } from '#shared/types/ynab'

// Expands a scheduled transaction into its occurrence dates within one month.
// All arithmetic is UTC on date-only values, anchored on date_first — YNAB's
// date_next only knows about the future, but the calendar shows past months.

const DAY_MS = 86_400_000

const DAY_STEPS: Partial<Record<string, number>> = {
  daily: 1, weekly: 7, everyOtherWeek: 14, every4Weeks: 28
}

const MONTH_STEPS: Partial<Record<string, number>> = {
  monthly: 1, everyOtherMonth: 2, every3Months: 3,
  every4Months: 4, twiceAYear: 6, yearly: 12, everyOtherYear: 24
}

const parseUtc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1)
}

const isoOf = (y: number, monthIndex: number, day: number) => {
  const mm = String(monthIndex + 1).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

// monthKey: 'YYYY-MM-01' (the app's month identifier)
export function occurrencesInMonth (txn: ScheduledTransaction, monthKey: string): string[] {
  const anchor = txn.date_first || txn.date_next
  if (!anchor || !monthKey) return []
  const [y, m] = monthKey.split('-').map(Number)
  if (!y || !m) return []
  const monthIndex = m - 1
  const daysInMonth = new Date(Date.UTC(y, monthIndex + 1, 0)).getUTCDate()
  const monthStart = Date.UTC(y, monthIndex, 1)
  const monthEnd = Date.UTC(y, monthIndex, daysInMonth)
  const anchorTime = parseUtc(anchor)
  const [ay, am, ad] = anchor.split('-').map(Number)

  if (txn.frequency === 'never') {
    const t = anchorTime
    return t >= monthStart && t <= monthEnd ? [anchor] : []
  }

  const dayStep = DAY_STEPS[txn.frequency]
  if (dayStep) {
    if (anchorTime > monthEnd) return []
    const stepMs = dayStep * DAY_MS
    // jump straight to the first occurrence at or after the month start
    const n = Math.max(0, Math.ceil((monthStart - anchorTime) / stepMs))
    const out: string[] = []
    for (let t = anchorTime + n * stepMs; t <= monthEnd; t += stepMs) {
      const dt = new Date(t)
      out.push(isoOf(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()))
    }
    return out
  }

  const monthStep = MONTH_STEPS[txn.frequency]
  if (monthStep) {
    const diff = (y - ay!) * 12 + (monthIndex - (am! - 1))
    if (diff < 0 || diff % monthStep !== 0) return []
    const day = Math.min(ad!, daysInMonth)
    const date = isoOf(y, monthIndex, day)
    return parseUtc(date) >= anchorTime ? [date] : []
  }

  if (txn.frequency === 'twiceAMonth') {
    const diff = (y - ay!) * 12 + (monthIndex - (am! - 1))
    if (diff < 0) return []
    const d0 = Math.min(ad!, daysInMonth)
    const d1 = ad! <= 15 ? Math.min(ad! + 15, daysInMonth) : Math.max(ad! - 15, 1)
    const days = [...new Set([d0, d1])].sort((a, b) => a - b)
    return days
      .map(day => isoOf(y, monthIndex, day))
      .filter(date => parseUtc(date) >= anchorTime)
  }

  return []
}

// Human phrasing for the day panel's detail line.
export function frequencyLabel (frequency: ScheduledTransaction['frequency']): string {
  const labels: Record<string, string> = {
    never: 'one time', daily: 'daily', weekly: 'weekly',
    everyOtherWeek: 'every other week', twiceAMonth: 'twice a month',
    every4Weeks: 'every 4 weeks', monthly: 'monthly',
    everyOtherMonth: 'every other month', every3Months: 'every 3 months',
    every4Months: 'every 4 months', twiceAYear: 'twice a year',
    yearly: 'yearly', everyOtherYear: 'every other year'
  }
  return labels[frequency] ?? frequency
}
