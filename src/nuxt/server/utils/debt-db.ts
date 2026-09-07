import { and, asc, eq, like } from 'drizzle-orm'
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
  userStartDate: string | null
  userStartBalance: number | null
  userName: string | null
  userBalance: number | null
  userPaidIn: number | null
  history: DebtHistoryPoint[]
  hidden: boolean
  updatedAt: string | null
}

export async function debtOwner (event: H3Event): Promise<string | null> {
  const user = await getSessionUser(event)
  if (user) return user.id
  // The anonymous "__env__" owner exists for dev/personal no-login mode. In
  // production it would let every unauthenticated visitor share one dataset
  // (and, with an env PAT set, the operator's YNAB) — so it is dev-only.
  if (!import.meta.dev) return null
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
    userStartDate: row.userStartDate,
    userStartBalance: row.userStartBalance,
    userName: row.userName,
    userBalance: row.userBalance,
    userPaidIn: row.userPaidIn,
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
  // A JSON import can carry the real month-by-month balances; without it the
  // history is a straight ramp between the two known points.
  history?: DebtHistoryPoint[]
  paidIn?: number
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
    paidIn: input.paidIn ?? Math.max(input.balance - input.startBalance, 0),
    rate: input.rate ?? null,
    minimumPayment: input.minimumPayment ?? null,
    history: JSON.stringify(input.history?.length ? input.history : linearHistory(input.startMonth, input.startBalance, endMonth, input.balance)),
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

export async function getDebtSourceType (userId: string, id: string): Promise<string | null> {
  const row = await db.select({ source: schema.debts.source }).from(schema.debts)
    .where(and(eq(schema.debts.id, id), eq(schema.debts.userId, userId)))
    .get()
  return row?.source ?? null
}

// Manual rows are fully user-shaped: structural edits rebuild the linear
// history exactly like creation does.
export async function updateManualDebt (userId: string, id: string, input: {
  name?: string
  startBalance: number
  balance: number
  startMonth: string
  endMonth: string | null
  rate: number | null
  minimumPayment: number | null
  history?: DebtHistoryPoint[]
  paidIn?: number
}): Promise<boolean> {
  const nowMonth = `${new Date().toISOString().slice(0, 7)}-01`
  const endMonth = input.endMonth ?? nowMonth
  const set: Record<string, unknown> = {
    startDate: input.startMonth.slice(0, 10),
    endDate: input.balance >= 0 ? endMonth.slice(0, 10) : null,
    startBalance: input.startBalance,
    balance: input.balance,
    paidIn: input.paidIn ?? Math.max(input.balance - input.startBalance, 0),
    rate: input.rate,
    minimumPayment: input.minimumPayment,
    history: JSON.stringify(input.history?.length
      ? input.history
      : linearHistory(input.startMonth, input.startBalance, input.balance >= 0 ? endMonth : nowMonth, input.balance)),
    updatedAt: new Date().toISOString()
  }
  if (input.name) set.name = input.name
  const rows = await db.update(schema.debts).set(set)
    .where(and(
      eq(schema.debts.id, id),
      eq(schema.debts.userId, userId),
      eq(schema.debts.source, 'manual')
    ))
    .returning({ id: schema.debts.id })
  return rows.length > 0
}

// JSON imports upsert by name so re-importing an edited export never
// duplicates a row. Case-insensitive; only hand-tracked rows are candidates.
export async function findManualDebtByName (userId: string, name: string): Promise<string | null> {
  const rows = await db.select({ id: schema.debts.id, name: schema.debts.name }).from(schema.debts)
    .where(and(eq(schema.debts.userId, userId), eq(schema.debts.source, 'manual')))
    .all()
  const wanted = name.trim().toLowerCase()
  return rows.find(row => row.name.trim().toLowerCase() === wanted)?.id ?? null
}

const PATCHABLE = ['name', 'rate', 'minimumPayment', 'hidden', 'userStartDate', 'userStartBalance', 'userName', 'userBalance', 'userPaidIn'] as const
export type DebtPatch = Partial<Pick<DebtRecord, typeof PATCHABLE[number]>>

export async function patchDebt (userId: string, id: string, patch: DebtPatch): Promise<boolean> {
  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (patch.name !== undefined) set.name = patch.name
  if (patch.rate !== undefined) set.rate = patch.rate
  if (patch.minimumPayment !== undefined) set.minimumPayment = patch.minimumPayment
  if (patch.hidden !== undefined) set.hidden = patch.hidden ? 1 : 0
  if (patch.userStartDate !== undefined) set.userStartDate = patch.userStartDate
  if (patch.userStartBalance !== undefined) set.userStartBalance = patch.userStartBalance
  if (patch.userName !== undefined) set.userName = patch.userName
  if (patch.userBalance !== undefined) set.userBalance = patch.userBalance
  if (patch.userPaidIn !== undefined) set.userPaidIn = patch.userPaidIn
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

// Payoff-strategy settings (strategy, snowball pool, extra, custom order,
// one-time lump payments) persist per owner in KV — small, single-row
// shaped, no migration needed.
export type DebtStrategy = 'minimum' | 'snowball' | 'avalanche' | 'custom'

// A dated lump sum (bonus, refund) folded into the payoff forecast. `every`
// months apart when > 0, `times` hits in total (0 = open-ended), aimed at
// one loan or (null) following the strategy's order.
export type DebtLumpKind = 'bonus' | 'refund' | 'gift' | 'sale' | 'boost' | 'other'
const LUMP_KINDS: DebtLumpKind[] = ['bonus', 'refund', 'gift', 'sale', 'boost', 'other']

export interface DebtLump {
  id: string
  kind: DebtLumpKind
  label: string
  month: string
  amount: number
  every: number
  times: number
  loanId: string | null
}

export interface DebtSettings {
  strategy: DebtStrategy
  snowball: number
  extra: number
  customOrder: string[]
  lumps: DebtLump[]
}

export const defaultDebtSettings: DebtSettings = { strategy: 'minimum', snowball: 0, extra: 0, customOrder: [], lumps: [] }

const STRATEGIES: DebtStrategy[] = ['minimum', 'snowball', 'avalanche', 'custom']
const MAX_LUMPS = 50

function cleanLumps (input: unknown): DebtLump[] {
  if (!Array.isArray(input)) return []
  const out: DebtLump[] = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const id = typeof item.id === 'string' ? item.id.slice(0, 64) : ''
    const month = typeof item.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(item.month) ? item.month : ''
    const amount = Math.round(Number(item.amount))
    if (!id || seen.has(id) || !month || !Number.isFinite(amount) || amount <= 0) continue
    seen.add(id)
    const every = Math.floor(Number(item.every))
    const times = Math.floor(Number(item.times))
    out.push({
      id,
      kind: LUMP_KINDS.includes(item.kind as DebtLumpKind) ? item.kind as DebtLumpKind : 'other',
      label: typeof item.label === 'string' ? item.label.trim().slice(0, 60) : '',
      month,
      amount,
      every: Number.isFinite(every) ? Math.min(Math.max(every, 0), 120) : 0,
      times: Number.isFinite(times) ? Math.min(Math.max(times, 0), 600) : 0,
      loanId: typeof item.loanId === 'string' && item.loanId.length < 100 ? item.loanId : null
    })
    if (out.length >= MAX_LUMPS) break
  }
  return out
}

const settingsKey = (owner: string) => `debt-settings:${owner}`

export async function getDebtSettings (owner: string): Promise<DebtSettings> {
  const stored = await kv.get<Partial<DebtSettings> & { strategy?: string, order?: string }>(settingsKey(owner))
  if (!stored) return { ...defaultDebtSettings }
  // Legacy shapes: 'separate' -> minimum; 'snowball' + order rate -> avalanche
  let strategy = stored.strategy as DebtStrategy | 'separate' | undefined
  if (strategy === 'separate') strategy = 'minimum'
  else if (strategy === 'snowball' && stored.order === 'rate') strategy = 'avalanche'
  return {
    strategy: STRATEGIES.includes(strategy as DebtStrategy) ? strategy as DebtStrategy : 'minimum',
    snowball: typeof stored.snowball === 'number' ? stored.snowball : 0,
    extra: typeof stored.extra === 'number' ? stored.extra : 0,
    customOrder: Array.isArray(stored.customOrder) ? stored.customOrder.filter(id => typeof id === 'string').slice(0, 100) : [],
    lumps: cleanLumps(stored.lumps)
  }
}

export async function putDebtSettings (owner: string, input: Partial<DebtSettings>): Promise<DebtSettings> {
  const current = await getDebtSettings(owner)
  const next: DebtSettings = {
    strategy: STRATEGIES.includes(input.strategy as DebtStrategy) ? input.strategy as DebtStrategy : current.strategy,
    snowball: Number.isFinite(Number(input.snowball)) ? Math.max(Math.round(Number(input.snowball)), 0) : current.snowball,
    extra: Number.isFinite(Number(input.extra)) ? Math.max(Math.round(Number(input.extra)), 0) : current.extra,
    customOrder: Array.isArray(input.customOrder)
      ? input.customOrder.filter(id => typeof id === 'string' && id.length < 100).slice(0, 100)
      : current.customOrder,
    lumps: Array.isArray(input.lumps) ? cleanLumps(input.lumps) : current.lumps
  }
  await kv.set(settingsKey(owner), next)
  return next
}

// Plan ids this owner has previously synced live debts from, recovered from
// the rows' source keys (`<planId>:<accountName>` — plan ids are uuids, so the
// first colon is unambiguous).
export async function syncedLivePlanIds (owner: string): Promise<string[]> {
  const rows = await db.select({ sourceKey: schema.debts.sourceKey }).from(schema.debts)
    .where(and(eq(schema.debts.userId, owner), eq(schema.debts.source, 'ynab')))
    .all()
  const ids = new Set<string>()
  for (const row of rows) {
    const id = row.sourceKey?.split(':')[0]
    if (id) ids.add(id)
  }
  return [...ids]
}

// ---- Sync throttle ---------------------------------------------------------
// Live YNAB syncs are limited to one per owner per cooldown window, protecting
// YNAB's API budget (200 requests/hour) from an eager sync button. Imports
// aren't throttled — they only read local KV. The stamp is recorded on
// SUCCESSFUL syncs, so a failed attempt can be retried immediately.
export const SYNC_COOLDOWN_SECONDS = 120

const syncStampKey = (owner: string) => `debt:sync-stamp:${owner}`

export async function assertSyncAllowed (owner: string): Promise<void> {
  const stamp = await kv.get<string>(syncStampKey(owner))
  if (!stamp) return
  const elapsed = (Date.now() - new Date(stamp).getTime()) / 1000
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= SYNC_COOLDOWN_SECONDS) return
  const wait = Math.ceil(SYNC_COOLDOWN_SECONDS - elapsed)
  throw createError({
    statusCode: 429,
    statusMessage: `Synced ${Math.floor(elapsed)}s ago — you can sync again in ${wait}s`
  })
}

export async function recordSync (owner: string): Promise<void> {
  await kv.set(syncStampKey(owner), new Date().toISOString())
}

// Removes the debt rows a budget source produced. Used when a source is
// deleted — the user chose "delete everything from that source".
export async function deleteDebtsFromSource (owner: string, source: 'ynab' | 'import', keyPrefix: string): Promise<number> {
  const rows = await db.delete(schema.debts)
    .where(and(
      eq(schema.debts.userId, owner),
      eq(schema.debts.source, source),
      like(schema.debts.sourceKey, `${keyPrefix}:%`)
    ))
    .returning({ id: schema.debts.id })
  return rows.length
}

export async function countDebtsFromSource (owner: string, source: 'ynab' | 'import', keyPrefix: string): Promise<number> {
  const rows = await db.select({ id: schema.debts.id }).from(schema.debts)
    .where(and(
      eq(schema.debts.userId, owner),
      eq(schema.debts.source, source),
      like(schema.debts.sourceKey, `${keyPrefix}:%`)
    ))
    .all()
  return rows.length
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