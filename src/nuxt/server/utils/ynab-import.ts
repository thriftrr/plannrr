import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import type { Category, MonthDetail, MonthSummary } from '#shared/types/ynab'

// Parses YNAB's "Export plan data" zip: "<Name> as of <date> - Plan.csv"
// (older exports say "- Budget.csv") plus an optional "- Register.csv".
// The export carries no goals, so each category's Assigned amount becomes its
// monthly baseline (synthesized as an MF goal); income per month is derived
// from Register rows categorized "Inflow: Ready to Assign".

export interface ImportedMonthCategory {
  id: string
  groupName: string
  name: string
  budgeted: number
  activity: number
  balance: number
}

export interface ImportedAccount {
  name: string
  startDate: string
  startBalance: number
  balance: number
  paidIn: number
  history: Array<{ month: string, balance: number }>
}

export interface ParsedImport {
  name: string
  months: Record<string, { income: number, categories: ImportedMonthCategory[] }>
  categoryCount: number
  accounts?: ImportedAccount[]
}

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
}

// "Apr 2026" -> "2026-04-01"
function monthKey (label: string): string | null {
  const match = /^([A-Za-z]{3})[a-z]* (\d{4})$/.exec(label.trim())
  if (!match) return null
  const month = MONTHS[match[1] as keyof typeof MONTHS]
  return month ? `${match[2]}-${month}-01` : null
}

// "$1,234.56" / "-$5.00" / "($5.00)" -> milliunits
function parseMoney (raw: string): number {
  const negative = raw.includes('-') || raw.includes('(')
  const cleaned = raw.replace(/[^0-9.]/g, '')
  if (!cleaned) return 0
  const value = Number.parseFloat(cleaned)
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 1000) * (negative ? -1 : 1)
}

// Minimal CSV parser handling quoted fields, doubled quotes, and CRLF.
export function parseCsv (text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const source = text.replace(/^﻿/, '')
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field); field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += char
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }
  return rows
}

const categoryId = (groupName: string, name: string) =>
  `impc_${createHash('sha256').update(`${groupName}|${name}`).digest('hex').slice(0, 12)}`

export function parseYnabExportZip (bytes: Uint8Array): ParsedImport {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'That file is not a readable zip archive' })
  }

  const decoder = new TextDecoder('utf-8')
  const planEntry = Object.keys(files).find(name => / - (Plan|Budget)\.csv$/.test(name))
  if (!planEntry) {
    throw createError({ statusCode: 400, statusMessage: 'No "… - Plan.csv" found — upload the zip from YNAB\'s Export Plan Data' })
  }
  const registerEntry = Object.keys(files).find(name => / - Register\.csv$/.test(name))

  const planName = planEntry.replace(/ as of .* - (Plan|Budget)\.csv$/, '').replace(/\.csv$/, '').trim() || 'Imported plan'

  const months: ParsedImport['months'] = {}
  const categoryIds = new Set<string>()

  const rows = parseCsv(decoder.decode(files[planEntry]!))
  const [header, ...dataRows] = rows
  if (!header || header.length < 7) {
    throw createError({ statusCode: 400, statusMessage: 'Unrecognized plan CSV format' })
  }

  const rowsByMonth: Record<string, ImportedMonthCategory[]> = {}
  for (const row of dataRows) {
    if (row.length < 7) continue
    const key = monthKey(row[0]!)
    if (!key) continue
    const groupName = row[2]!.trim()
    const name = row[3]!.trim()
    if (!groupName || !name) continue
    rowsByMonth[key] ??= []
    rowsByMonth[key].push({
      id: categoryId(groupName, name),
      groupName,
      name,
      budgeted: parseMoney(row[4]!),
      activity: parseMoney(row[5]!),
      balance: parseMoney(row[6]!)
    })
  }

  for (const [key, allRows] of Object.entries(rowsByMonth)) {
    // Drop fully-zero rows so dormant categories don't clutter active months —
    // but a month with no activity at all (a fresh plan, or a future month)
    // keeps its full structure instead of vanishing.
    const active = allRows.filter(row => row.budgeted !== 0 || row.activity !== 0 || row.balance !== 0)
    const kept = active.length ? active : allRows
    months[key] = { income: 0, categories: kept }
    for (const row of kept) categoryIds.add(row.id)
  }

  let accounts: ImportedAccount[] = []
  if (registerEntry) {
    const registerRows = parseCsv(decoder.decode(files[registerEntry]!))
    const [registerHeader, ...transactions] = registerRows
    const accountIdx = registerHeader?.indexOf('Account') ?? -1
    const payeeIdx = registerHeader?.indexOf('Payee') ?? -1
    const combinedIdx = registerHeader?.indexOf('Category Group/Category') ?? -1
    const dateIdx = registerHeader?.indexOf('Date') ?? -1
    const outflowIdx = registerHeader?.indexOf('Outflow') ?? -1
    const inflowIdx = registerHeader?.indexOf('Inflow') ?? -1

    if (combinedIdx >= 0 && dateIdx >= 0 && inflowIdx >= 0) {
      const txByAccount = new Map<string, Array<{ date: string, payee: string, amount: number }>>()

      for (const row of transactions) {
        const date = /(\d{2})\/(\d{2})\/(\d{4})/.exec(row[dateIdx] ?? '')
        if (!date) continue
        const monthKeyOfTx = `${date[3]}-${date[1]}-01`
        const inflow = parseMoney(row[inflowIdx] ?? '')

        if (row[combinedIdx] === 'Inflow: Ready to Assign' && months[monthKeyOfTx]) {
          months[monthKeyOfTx].income += inflow
        }

        if (accountIdx >= 0 && outflowIdx >= 0) {
          const account = row[accountIdx]?.trim()
          if (!account) continue
          let list = txByAccount.get(account)
          if (!list) {
            list = []
            txByAccount.set(account, list)
          }
          list.push({
            date: `${date[3]}-${date[1]}-${date[2]}`,
            payee: row[payeeIdx]?.trim() ?? '',
            amount: inflow - parseMoney(row[outflowIdx] ?? '')
          })
        }
      }

      accounts = buildAccountHistories(txByAccount)
    }
  }

  if (Object.keys(months).length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'No monthly data found in that export' })
  }

  return { name: planName, months, categoryCount: categoryIds.size, accounts }
}

function nextMonthKey (key: string): string {
  const [year, month] = key.split('-').map(Number)
  return month === 12 ? `${year! + 1}-01-01` : `${year}-${String(month! + 1).padStart(2, '0')}-01`
}

// Rebuild each account's balance-over-time from its transactions (YNAB
// registers open with a "Starting Balance" row, so the running sum is the
// true balance), snapshotted at end of month and carried forward to the
// export's last month so every account covers the same time axis.
function buildAccountHistories (txByAccount: Map<string, Array<{ date: string, payee: string, amount: number }>>): ImportedAccount[] {
  let globalEndMonth = ''
  for (const txs of txByAccount.values()) {
    for (const tx of txs) {
      const key = `${tx.date.slice(0, 7)}-01`
      if (key > globalEndMonth) globalEndMonth = key
    }
  }
  if (!globalEndMonth) return []

  const accounts: ImportedAccount[] = []
  for (const [name, txs] of txByAccount) {
    txs.sort((a, b) => a.date.localeCompare(b.date))
    const endOfMonth: Record<string, number> = {}
    let running = 0
    let paidIn = 0
    let startBalance = 0
    for (const tx of txs) {
      running += tx.amount
      if (tx.payee === 'Starting Balance') startBalance += tx.amount
      else if (tx.amount > 0) paidIn += tx.amount
      endOfMonth[`${tx.date.slice(0, 7)}-01`] = running
    }

    const startMonth = `${txs[0]!.date.slice(0, 7)}-01`
    const history: ImportedAccount['history'] = []
    let carried = 0
    for (let key = startMonth; key <= globalEndMonth; key = nextMonthKey(key)) {
      if (key in endOfMonth) carried = endOfMonth[key]!
      history.push({ month: key, balance: carried })
      if (history.length > 600) break
    }

    accounts.push({
      name,
      startDate: txs[0]!.date,
      startBalance,
      balance: running,
      paidIn,
      history
    })
  }
  return accounts.sort((a, b) => a.balance - b.balance)
}

// ---- Adapters into the shapes the sandbox already speaks ------------------

export function importedMonthSummaries (parsed: ParsedImport): MonthSummary[] {
  return Object.entries(parsed.months)
    .map(([month, data]) => {
      const budgeted = data.categories.reduce((sum, category) => sum + category.budgeted, 0)
      const activity = data.categories.reduce((sum, category) => sum + category.activity, 0)
      return { month, income: data.income, budgeted, activity, to_be_budgeted: data.income - budgeted, deleted: false }
    })
    .sort((a, b) => b.month.localeCompare(a.month))
}

export function importedMonthDetail (parsed: ParsedImport, month: string): MonthDetail | null {
  const data = parsed.months[month]
  if (!data) return null
  const categories: Category[] = data.categories.map(category => ({
    id: category.id,
    category_group_id: category.groupName,
    category_group_name: category.groupName,
    name: category.name,
    hidden: false,
    internal: false,
    budgeted: category.budgeted,
    activity: category.activity,
    balance: category.balance,
    // Exports carry no goals: the assigned amount stands in as the monthly
    // baseline so every funded category appears in the sandbox.
    goal_type: 'MF',
    goal_target: category.budgeted,
    deleted: false
  }))
  const budgeted = categories.reduce((sum, category) => sum + category.budgeted, 0)
  const activity = categories.reduce((sum, category) => sum + category.activity, 0)
  return { month, income: data.income, budgeted, activity, to_be_budgeted: data.income - budgeted, deleted: false, categories }
}
