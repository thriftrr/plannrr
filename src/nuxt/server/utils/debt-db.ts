import { and, asc, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { nextMonthKey } from './ynab-import'

// The debts table is the debt page's single source of truth: synced rows
// from YNAB/imports plus manual entries (things YNAB never saw, paid-off
// trophies included). The env-PAT no-login mode owns rows under '__env__'.

export interface DebtHistoryPoint { month: string, balance: number }

export interface DebtRecord {
  id: string
  source: 'ynab' | 'import' | 'manual'
  planName: string
  name: string
  startDate: string
  endDate: string | null
  startBalance: number
  balance: number
  paidIn: number
  rate: number | null
  minimumPayment: number | null
  history: DebtHistoryPoint[]
  hidden: boolean
  updatedAt: string | null
}

export async function debtOwner (event: H3Event): Promise<string | null> {
  const user = await getSessionUser(event)
  if (user) return user.id
  const { ynabPersonalAccessToken } = useRuntimeConfig()
  return ynabPersonalAccessToken ? '__env__' : null
}

export async function requireDebtOwner (event: H3Event): Promise<string> {
  const owner = await debtOwner(event)
  if (!owner) throw createError({ statusCode: 401, statusMessage: 'Sign in required' })
  return owner
}

type DebtRow = typeof schema.debts.$inferSelect

function toRecord (row: DebtRow): DebtRecord {
  let history: DebtHistoryPoint[] = []
  try {
    history = JSON.parse(row.history)
  } catch { /* corrupted history renders as empty */ }
  return {
    id: row.id,
    source: row.source as DebtRecord['source'],
    planName: row.planName,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    startBalance: row.startBalance,
    balance: row.balance,
    paidIn: row.paidIn,
    rate: row.rate,
    minimumPayment: row.minimumPayment,
    history,
    hidden: Boolean(row.hidden),
    updatedAt: row.updatedAt
  }
}

export async function listDebts (userId: string): Promise<DebtRecord[]> {
  const rows = await db.select().from(schema.debts)
    .where(eq(schema.debts.userId, userId))
    .orderBy(asc(schema.debts.balance), asc(schema.debts.createdAt))
    .all()
  return rows.map(toRecord)
}

export interface SyncedDebtData {
  planName: string
  name: string
  startDate: string
  startBalance: number
  balance: number
  paidIn: number
  rate?: number
  minimumPayment?: number
  history: DebtHistoryPoint[]
}

// Upsert by (user, sourceKey). Sync owns the factual fields; rate and
// minimum only fill in when the user hasn't set them (user edits win).
export async function upsertSyncedDebt (
  userId: string,
  source: 'ynab' | 'import',
  sourceKey: string,
  data: SyncedDebtData
): Promise<'created' | 'updated'> {
  const existing = await db.select().from(schema.debts)
    .where(and(eq(schema.debts.userId, userId), eq(schema.debts.sourceKey, sourceKey)))
    .get()

  const factual = {
    planName: data.planName,
    name: data.name,
    startDate: data.startDate,
    startBalance: data.startBalance,
    balance: data.balance,
    paidIn: data.paidIn,
    history: JSON.stringify(data.history),
    endDate: data.balance >= 0 ? new Date().toISOString().slice(0, 10) : null,
    updatedAt: new Date().toISOString()
  }

  if (existing) {
    await db.update(schema.debts).set({
      ...factual,
      rate: existing.rate ?? data.rate ?? null,
      minimumPayment: existing.minimumPayment ?? data.minimumPayment ?? null
    }).where(eq(schema.debts.id, existing.id)).run()
    return 'updated'
  }

  await db.insert(schema.debts).values({
    id: `debt_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    userId,
    source,
    sourceKey,
    ...factual,
    rate: data.rate ?? null,
    minimumPayment: data.minimumPayment ?? null
  }).run()
  return 'created'
}

export async function createManualDebt (userId: string, input: {
  name: string
  startBalance: number
  balance: number
  startMonth: string
  endMonth: string | null
  rate?: number
  minimumPayment?: number
}): Promise<DebtRecord> {
  const endMonth = input.endMonth ?? new Date().toISOString().slice(0, 7) + '-01'
  const row = {
    id: `debt_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    userId,
    source: 'manual' as const,
    sourceKey: null,
    planName: '',
    name: input.name,
    startDate: input.startMonth.slice(0, 10),
    endDate: input.balance >= 0 ? endMonth.slice(0, 10) : null,
    startBalance: input.startBalance,
    balance: input.balance,
    paidIn: Math.max(input.balance - input.startBalance, 0),
    rate: input.rate ?? null,
    minimumPayment: input.minimumPayment ?? null,
    history: JSON.stringify(linearHistory(input.startMonth, input.startBalance, endMonth, input.balance)),
    hidden: 0,
    updatedAt: new Date().toISOString()
  }
  await db.insert(schema.debts).values(row).run()
  return toRecord(row as unknown as DebtRow)
}

// Manual debts have no transaction log — chart them as a straight paydown
// between the two known points.
export function linearHistory (startMonth: string, startBalance: number, endMonth: string, endBalance: number): DebtHistoryPoint[] {
  const months: string[] = []
  for (let key = startMonth; key <= endMonth; key = nextMonthKey(key)) {
    months.push(key)
    if (months.length > 600) break
  }
  if (months.length <= 1) return [{ month: endMonth, balance: endBalance }]
  const span = months.length - 1
  return months.map((month, index) => ({
    month,
    balance: Math.round(startBalance + ((endBalance - startBalance) * index) / span)
  }))
}

const PATCHABLE = ['name', 'rate', 'minimumPayment', 'hidden'] as const
export type DebtPatch = Partial<Pick<DebtRecord, typeof PATCHABLE[number]>>

export async function patchDebt (userId: string, id: string, patch: DebtPatch): Promise<boolean> {
  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (patch.name !== undefined) set.name = patch.name
  if (patch.rate !== undefined) set.rate = patch.rate
  if (patch.minimumPayment !== undefined) set.minimumPayment = patch.minimumPayment
  if (patch.hidden !== undefined) set.hidden = patch.hidden ? 1 : 0
  const rows = await db.update(schema.debts).set(set)
    .where(and(eq(schema.debts.id, id), eq(schema.debts.userId, userId)))
    .returning({ id: schema.debts.id })
  return rows.length > 0
}

export async function deleteDebt (userId: string, id: string): Promise<boolean> {
  const rows = await db.delete(schema.debts)
    .where(and(eq(schema.debts.id, id), eq(schema.debts.userId, userId)))
    .returning({ id: schema.debts.id })
  return rows.length > 0
}

export async function lastSyncedAt (userId: string): Promise<string | null> {
  const rows = await db.select({ updatedAt: schema.debts.updatedAt }).from(schema.debts)
    .where(eq(schema.debts.userId, userId))
    .all()
  let latest: string | null = null
  for (const row of rows) {
    if (row.updatedAt && (!latest || row.updatedAt > latest)) latest = row.updatedAt
  }
  return latest
}