// Debt Colectrr JSON import: the shape written by "Export JSON" on the page,
// amounts in decimal currency units. Every row becomes (or refreshes) a
// hand-tracked debt — synced rows are YNAB's and are never touched. Rows
// are matched to existing manual debts by name so re-importing an edited
// export updates in place instead of duplicating.

const MONTH_RE = /^\d{4}-\d{2}(-\d{2})?$/
const MAX_ROWS = 200
const MAX_HISTORY = 600

interface ImportRow {
  name?: unknown
  startDate?: unknown
  endDate?: unknown
  startBalance?: unknown
  balance?: unknown
  paidIn?: unknown
  rate?: unknown
  minimumPayment?: unknown
  history?: unknown
}

const monthKey = (value: string) => `${value.slice(0, 7)}-01`

function num (value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

export default defineEventHandler(async (event) => {
  const owner = await requireDebtOwner(event)
  const body = await readBody<{ debts?: unknown }>(event)
  const rows = Array.isArray(body?.debts) ? body!.debts as ImportRow[] : null
  if (!rows) throw createError({ statusCode: 400, statusMessage: 'Expected { "debts": [ … ] }' })
  if (rows.length > MAX_ROWS) throw createError({ statusCode: 400, statusMessage: `At most ${MAX_ROWS} debts per import` })

  let created = 0
  let updated = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const label = `Debt ${i + 1}`
    if (!row || typeof row !== 'object') throw createError({ statusCode: 400, statusMessage: `${label} isn't an object` })

    const name = typeof row.name === 'string' ? row.name.trim().slice(0, 120) : ''
    if (!name) throw createError({ statusCode: 400, statusMessage: `${label} needs a name` })

    const original = Math.abs(num(row.startBalance) ?? 0)
    if (!(original > 0)) throw createError({ statusCode: 400, statusMessage: `${label} (${name}): startBalance must be a positive amount` })
    const balance = Math.abs(num(row.balance) ?? 0)
    if (balance > original) throw createError({ statusCode: 400, statusMessage: `${label} (${name}): balance can't exceed startBalance` })

    const startDate = typeof row.startDate === 'string' ? row.startDate.trim() : ''
    if (!MONTH_RE.test(startDate)) throw createError({ statusCode: 400, statusMessage: `${label} (${name}): startDate must be YYYY-MM` })
    const endDate = typeof row.endDate === 'string' && row.endDate.trim() ? row.endDate.trim() : null
    if (endDate && !MONTH_RE.test(endDate)) throw createError({ statusCode: 400, statusMessage: `${label} (${name}): endDate must be YYYY-MM` })

    const rate = num(row.rate)
    const minimum = num(row.minimumPayment)
    const paidIn = num(row.paidIn)

    // Optional month-by-month balances. Stored as negatives (YNAB's sign for
    // liabilities); the export writes them positive for readability.
    let history: Array<{ month: string, balance: number }> | undefined
    if (Array.isArray(row.history) && row.history.length) {
      if (row.history.length > MAX_HISTORY) throw createError({ statusCode: 400, statusMessage: `${label} (${name}): history is too long` })
      history = []
      for (const point of row.history as Array<{ month?: unknown, balance?: unknown }>) {
        const month = typeof point?.month === 'string' ? point.month.trim() : ''
        const value = num(point?.balance)
        if (!MONTH_RE.test(month) || value === null) {
          throw createError({ statusCode: 400, statusMessage: `${label} (${name}): each history point needs "month": "YYYY-MM" and a numeric "balance"` })
        }
        history.push({ month: monthKey(month), balance: -Math.round(Math.abs(value) * 1000) })
      }
      history.sort((a, b) => a.month.localeCompare(b.month))
    }

    const shape = {
      name,
      startBalance: -Math.round(original * 1000),
      balance: -Math.round(balance * 1000),
      startMonth: monthKey(startDate),
      endMonth: endDate ? monthKey(endDate) : null,
      history,
      paidIn: paidIn !== null ? Math.max(Math.round(Math.abs(paidIn) * 1000), 0) : undefined
    }

    const existing = await findManualDebtByName(owner, name)
    if (existing) {
      await updateManualDebt(owner, existing, {
        ...shape,
        rate: rate !== null && rate > 0 ? rate : null,
        minimumPayment: minimum !== null && minimum > 0 ? Math.round(minimum * 1000) : null
      })
      updated++
    } else {
      await createManualDebt(owner, {
        ...shape,
        rate: rate !== null && rate > 0 ? rate : undefined,
        minimumPayment: minimum !== null && minimum > 0 ? Math.round(minimum * 1000) : undefined
      })
      created++
    }
  }

  return { created, updated }
})
