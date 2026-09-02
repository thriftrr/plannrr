import type { BudgetTransaction } from '#shared/types/ynab'
import type { DetectedSeries, SeriesCadence } from '#shared/types/recurring'

// ============================================================================
// Recurring-transaction detection, projection, and the calendar's morning-
// balance line. Pure functions over register rows — no fetching, no state —
// so every rule here is unit-testable.
//
// Confidence tiers (the user's spec, verbatim intent):
//   gold    same payee + same amount + same day(s)-of-month
//   strong  same payee + same amount, day drifts — tied with —
//           same payee + same day, amount drifts (most recent amount projects)
//   maybe   same payee with a rhythm but neither stable → suggestions only
// ============================================================================

const DAY_MS = 86_400_000

const parseUtc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1)
}

const isoOf = (y: number, monthIndex: number, day: number) =>
  `${y}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

const dayOf = (iso: string) => Number(iso.slice(8, 10))
const monthOf = (iso: string) => iso.slice(0, 7)

const daysInMonth = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate()
}

// "YYYY-MM-01" for the month `offset` months after monthKey's month.
export function shiftMonthKey (monthKey: string, offset: number): string {
  const [y, m] = monthKey.split('-').map(Number)
  const index = (y! * 12 + (m! - 1)) + offset
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`
}

const monthIndexOf = (monthKey: string) => {
  const [y, m] = monthKey.split('-').map(Number)
  return y! * 12 + (m! - 1)
}

// Payees compare with emoji, punctuation, and case stripped, so "🏠 Hometown
// Property Mgmt" and "hometown property mgmt" are one vendor — and a detected
// series can be matched against a YNAB scheduled transaction's payee.
export function normalizePayee (payee: string): string {
  return payee
    .replace(/^transfer\s*:\s*/i, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const median = (values: number[]): number => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

const gapsOf = (dates: string[]): number[] => {
  const out: number[] = []
  for (let i = 1; i < dates.length; i++) {
    out.push(Math.round((parseUtc(dates[i]!) - parseUtc(dates[i - 1]!)) / DAY_MS))
  }
  return out
}

type CadenceGuess = { cadence: SeriesCadence, days: number[], stableDays: boolean } | null

// Two stable day-of-month centers ~half a month apart (payroll on the 3rd and
// the 18th) — detected as ONE semimonthly series.
function semimonthlyDays (dates: string[]): number[] | null {
  const days = dates.map(dayOf)
  const unique = [...new Set(days)].sort((a, b) => a - b)
  if (unique.length < 2) return null
  // split the unique days at the widest gap and test the two groups
  let splitAt = 1
  let widest = -1
  for (let i = 1; i < unique.length; i++) {
    const gap = unique[i]! - unique[i - 1]!
    if (gap > widest) { widest = gap; splitAt = i }
  }
  const low = unique.slice(0, splitAt)
  const high = unique.slice(splitAt)
  const spread = (group: number[]) => group[group.length - 1]! - group[0]!
  if (spread(low) > 4 || spread(high) > 4) return null
  const c1 = median(low)
  const c2 = median(high)
  if (c2 - c1 < 10 || c2 - c1 > 20) return null
  const inLow = days.filter(d => Math.abs(d - c1) <= 2).length
  const inHigh = days.filter(d => Math.abs(d - c2) <= 2).length
  if (inLow < 2 || inHigh < 2 || inLow + inHigh < days.length - 1) return null
  return [c1, c2]
}

function guessCadence (dates: string[]): CadenceGuess {
  if (dates.length < 3) return null
  const gaps = gapsOf(dates)
  const medianGap = median(gaps)

  const semi = semimonthlyDays(dates)
  if (semi && medianGap >= 12 && medianGap <= 18) {
    return { cadence: 'semimonthly', days: semi, stableDays: true }
  }
  if (medianGap >= 27 && medianGap <= 33) {
    const days = dates.map(dayOf)
    const center = median(days)
    // ±3 (autopay drifts over weekends), with month-length wrap tolerance
    // (the 31st clamps to the 28th in February)
    const stable = days.every(d => Math.abs(d - center) <= 3 || (center >= 28 && d >= 26))
    return { cadence: 'monthly', days: [center], stableDays: stable }
  }
  if (medianGap >= 12 && medianGap <= 16) return { cadence: 'biweekly', days: [], stableDays: false }
  if (medianGap >= 6 && medianGap <= 8) return { cadence: 'weekly', days: [], stableDays: false }
  return null
}

const CADENCE_DAYS: Record<SeriesCadence, number> = {
  weekly: 7, biweekly: 14, semimonthly: 16, monthly: 31
}

// A series is alive when its last occurrence is recent enough that the next
// one is still expected — dead subscriptions must not project forever.
function isAlive (anchorDate: string, registerEnd: string, cadence: SeriesCadence): boolean {
  const gap = (parseUtc(registerEnd) - parseUtc(anchorDate)) / DAY_MS
  return gap <= CADENCE_DAYS[cadence] * 1.9 + 3
}

// Transfers with BOTH sides in the register (same day, equal-and-opposite,
// both flagged transfer) just move money within the budget — they cancel and
// must not chart or detect. A ONE-SIDED transfer is money truly leaving (a
// loan payment to a tracking account) or arriving: a real event.
export function pairedTransferSet (transactions: BudgetTransaction[]): Set<BudgetTransaction> {
  const paired = new Set<BudgetTransaction>()
  const open = new Map<string, BudgetTransaction[]>()
  for (const txn of transactions) {
    if (!txn.transfer) continue
    const matchKey = `${txn.date}|${-txn.amount}`
    const queue = open.get(matchKey)
    if (queue?.length) {
      paired.add(queue.shift()!)
      paired.add(txn)
    } else {
      const ownKey = `${txn.date}|${txn.amount}`
      if (!open.has(ownKey)) open.set(ownKey, [])
      open.get(ownKey)!.push(txn)
    }
  }
  return paired
}

export function detectSeries (transactions: BudgetTransaction[]): DetectedSeries[] {
  const paired = pairedTransferSet(transactions)
  const rows = transactions
    .filter(txn => !paired.has(txn) && txn.payee.trim() && txn.amount !== 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (rows.length < 3) return []
  const registerEnd = rows[rows.length - 1]!.date

  const byPayee = new Map<string, BudgetTransaction[]>()
  for (const txn of rows) {
    const key = normalizePayee(txn.payee)
    if (!key) continue
    let list = byPayee.get(key)
    if (!list) { list = []; byPayee.set(key, list) }
    list.push(txn)
  }

  const out: DetectedSeries[] = []
  for (const [normalized, group] of byPayee) {
    if (group.length < 3) continue
    const series = detectForPayee(normalized, group, registerEnd)
    if (series) out.push(series)
  }
  return out.sort((a, b) => a.payee.localeCompare(b.payee))
}

// One series per vendor, best tier wins: amount-stable, then day-stable,
// then rhythm-only.
function detectForPayee (normalized: string, group: BudgetTransaction[], registerEnd: string): DetectedSeries | null {
  const displayPayee = group[group.length - 1]!.payee
  const base = {
    payee: displayPayee,
    normalizedPayee: normalized,
    occurrences: group.length
  }

  // --- amount-stable clusters (gold, or strong when the day drifts) ---------
  const byAmount = new Map<number, BudgetTransaction[]>()
  for (const txn of group) {
    let list = byAmount.get(txn.amount)
    if (!list) { list = []; byAmount.set(txn.amount, list) }
    list.push(txn)
  }
  const amountClusters = [...byAmount.values()]
    .filter(cluster => cluster.length >= 3)
    .sort((a, b) => b[b.length - 1]!.date.localeCompare(a[a.length - 1]!.date))
  for (const cluster of amountClusters) {
    const dates = cluster.map(txn => txn.date)
    const guess = guessCadence(dates)
    if (!guess) continue
    const anchorDate = dates[dates.length - 1]!
    if (!isAlive(anchorDate, registerEnd, guess.cadence)) continue
    const amount = cluster[cluster.length - 1]!.amount
    return {
      ...base,
      key: `${normalized}|amt|${guess.cadence}`,
      confidence: guess.stableDays ? 'gold' : 'strong',
      cadence: guess.cadence,
      kind: amount > 0 ? 'income' : 'bill',
      amount,
      days: guess.days.length ? guess.days : [dayOf(anchorDate)],
      anchorDate,
      occurrences: cluster.length
    }
  }

  // --- day-stable, amount drifts (strong; most recent amount projects) ------
  const dates = group.map(txn => txn.date)
  const dayGuess = guessCadence(dates)
  if (dayGuess && (dayGuess.cadence === 'monthly' || dayGuess.cadence === 'semimonthly') && dayGuess.stableDays) {
    const anchorDate = dates[dates.length - 1]!
    if (isAlive(anchorDate, registerEnd, dayGuess.cadence)) {
      const amount = group[group.length - 1]!.amount
      return {
        ...base,
        key: `${normalized}|day|${dayGuess.cadence}`,
        confidence: 'strong',
        cadence: dayGuess.cadence,
        kind: amount > 0 ? 'income' : 'bill',
        amount,
        days: dayGuess.days,
        anchorDate,
        occurrences: group.length
      }
    }
  }

  // --- rhythm only (maybe → suggestions view) --------------------------------
  const gaps = gapsOf(dates)
  const medianGap = median(gaps)
  const months = new Set(dates.map(monthOf))
  const anchorDate = dates[dates.length - 1]!
  if (medianGap >= 2 && medianGap <= 40 && months.size >= 2) {
    const cadence: SeriesCadence = medianGap <= 8 ? 'weekly' : medianGap <= 18 ? 'biweekly' : 'monthly'
    if (isAlive(anchorDate, registerEnd, cadence)) {
      const amount = median(group.map(txn => txn.amount))
      return {
        ...base,
        key: `${normalized}|rhythm|${cadence}`,
        confidence: 'maybe',
        cadence,
        kind: amount > 0 ? 'income' : 'bill',
        amount,
        days: cadence === 'monthly' ? [dayOf(anchorDate)] : [],
        anchorDate,
        occurrences: group.length
      }
    }
  }
  return null
}

// Occurrence dates for one series inside one month — strictly after the
// anchor (the last real transaction), so projections never overlap actuals.
export function projectSeriesDates (series: DetectedSeries, monthKey: string): string[] {
  const [y, m] = monthKey.split('-').map(Number)
  if (!y || !m) return []
  const monthIndex = m - 1
  const days = daysInMonth(monthKey)
  const anchorTime = parseUtc(series.anchorDate)

  if (series.cadence === 'monthly' || series.cadence === 'semimonthly') {
    return series.days
      .map(day => isoOf(y, monthIndex, Math.min(Math.max(day, 1), days)))
      .filter(date => parseUtc(date) > anchorTime)
      .sort()
  }

  const stepMs = (series.cadence === 'weekly' ? 7 : 14) * DAY_MS
  const monthStart = Date.UTC(y, monthIndex, 1)
  const monthEnd = Date.UTC(y, monthIndex, days)
  if (anchorTime + stepMs > monthEnd) return []
  // jump straight to the first step after the anchor that lands in the month
  const skips = Math.max(1, Math.ceil((monthStart - anchorTime) / stepMs))
  const out: string[] = []
  for (let t = anchorTime + skips * stepMs; t <= monthEnd; t += stepMs) {
    const dt = new Date(t)
    out.push(isoOf(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()))
  }
  return out
}

// A custom monthly's date inside one month (day clamped to month length).
export function customDateInMonth (day: number, monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  return isoOf(y!, m! - 1, Math.min(Math.max(day, 1), daysInMonth(monthKey)))
}

// ============================================================================
// Morning balances — "the top of the day". A bill on the 1st is visible as
// money gone on the morning of the 2nd.
// ============================================================================

export interface BalanceSource {
  transactions: BudgetTransaction[]
  balanceNow: number | null
  // When balanceNow comes from accounts typed by hand rather than a register,
  // the date it's true for (today) — the chain projects forward from here.
  anchorDate?: string
  // Editable seed for sources with no register; means "balance at the start
  // of the current real month".
  startingBalance: number | null
  // Zip registers are complete account history, so months before the window
  // still compute truthfully; capped API windows do not.
  completeHistory?: boolean
  // Projected occurrences (detected + scheduled + custom, already deduped)
  // for any month the chain needs.
  projectedFor: (monthKey: string) => Array<{ date: string, amount: number }>
}

const CHAIN_LIMIT_MONTHS = 12

// Returns morning balances for days 1..daysInMonth+1 of the viewed month
// (day N+1 is next month's first morning — the "closing" of the last day),
// or null when no selected source can contribute.
export function buildMorningBalances (
  sources: BalanceSource[],
  monthKey: string,
  currentMonthKey: string
): Map<number, number> | null {
  const days = daysInMonth(monthKey)
  const totals = new Map<number, number>()
  let contributors = 0

  for (const source of sources) {
    const contribution = sourceMornings(source, monthKey, days, currentMonthKey)
    if (!contribution) continue
    contributors++
    for (let d = 1; d <= days + 1; d++) {
      totals.set(d, (totals.get(d) ?? 0) + contribution[d - 1]!)
    }
  }
  return contributors ? totals : null
}

function sourceMornings (
  source: BalanceSource,
  monthKey: string,
  days: number,
  currentMonthKey: string
): number[] | null {
  const [y, m] = monthKey.split('-').map(Number)
  const monthIndex = m! - 1
  const morningIso = (d: number) => d <= days
    ? isoOf(y!, monthIndex, d)
    : shiftMonthKey(monthKey, 1)

  // ---- register-anchored path (or a hand-typed balance anchored at today) ----
  if (source.balanceNow !== null && (source.transactions.length || source.anchorDate)) {
    const txns = source.transactions
    const anchor = txns.length ? txns[txns.length - 1]!.date : source.anchorDate!
    const first = txns.length ? txns[0]!.date : anchor
    const monthEndIso = isoOf(y!, monthIndex, days)

    // A capped window can't see far enough back to be truthful.
    if (!source.completeHistory && monthEndIso < first) return null
    const monthsAhead = monthIndexOf(monthKey) - monthIndexOf(`${monthOf(anchor)}-01`)
    if (monthsAhead > CHAIN_LIMIT_MONTHS) return null

    // suffix sums over the register: total of txns dated >= iso
    const suffix: number[] = new Array(txns.length + 1).fill(0)
    for (let i = txns.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1]! + txns[i]!.amount
    const totalOnOrAfter = (iso: string) => {
      let lo = 0
      let hi = txns.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (txns[mid]!.date < iso) lo = mid + 1
        else hi = mid
      }
      return suffix[lo]!
    }

    // projected occurrences from the anchor's month through the month after
    // the viewed one, gathered once
    const projected: Array<{ date: string, amount: number }> = []
    if (monthsAhead >= 0) {
      const anchorMonthKey = `${monthOf(anchor)}-01`
      const span = monthIndexOf(shiftMonthKey(monthKey, 1)) - monthIndexOf(anchorMonthKey)
      for (let i = 0; i <= span; i++) {
        for (const occ of source.projectedFor(shiftMonthKey(anchorMonthKey, i))) {
          if (occ.date > anchor) projected.push(occ)
        }
      }
    }

    const out: number[] = []
    for (let d = 1; d <= days + 1; d++) {
      const iso = morningIso(d)
      if (iso <= anchor) {
        out.push(source.balanceNow - totalOnOrAfter(iso))
      } else {
        let bal = source.balanceNow
        for (const occ of projected) if (occ.date < iso) bal += occ.amount
        out.push(bal)
      }
    }
    return out
  }

  // ---- manual seed path ----
  if (source.startingBalance !== null) {
    const ahead = monthIndexOf(monthKey) - monthIndexOf(currentMonthKey)
    if (ahead < 0 || ahead > CHAIN_LIMIT_MONTHS) return null
    const projected: Array<{ date: string, amount: number }> = []
    for (let i = 0; i <= ahead + 1; i++) {
      projected.push(...source.projectedFor(shiftMonthKey(currentMonthKey, i)))
    }
    const out: number[] = []
    for (let d = 1; d <= days + 1; d++) {
      const iso = morningIso(d)
      let bal = source.startingBalance
      for (const occ of projected) if (occ.date >= currentMonthKey && occ.date < iso) bal += occ.amount
      out.push(bal)
    }
    return out
  }

  return null
}

// Most common category among a vendor's rows — so planned chips can speak in
// Tinkrr's language (categories), never the vendor's.
export function dominantCategory (transactions: BudgetTransaction[], normalizedPayee: string): string | null {
  const counts = new Map<string, number>()
  for (const txn of transactions) {
    if (!txn.category) continue
    if (normalizePayee(txn.payee) !== normalizedPayee) continue
    counts.set(txn.category, (counts.get(txn.category) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [category, count] of counts) {
    if (count > bestCount) { best = category; bestCount = count }
  }
  return best
}

// Cadence phrasing for the rail ("monthly · around the 1st").
export function cadenceLabel (series: DetectedSeries): string {
  const ord = (d: number) => {
    const suffix = d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th'
    return `${d}${suffix}`
  }
  if (series.cadence === 'semimonthly') return `twice a month · the ${series.days.map(ord).join(' & ')}`
  if (series.cadence === 'monthly') return `monthly · around the ${ord(series.days[0] ?? dayOf(series.anchorDate))}`
  return series.cadence === 'weekly' ? 'about weekly' : 'about every two weeks'
}
