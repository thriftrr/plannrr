import type { AccountPrefs, CustomMonthly, ManualAccount, RecurringPrefs } from '#shared/types/recurring'

// Storage + validation for per-source recurring-transaction preferences.
// The shapes live in shared/types/recurring.ts so the client's detection
// engine and this store can never drift. (Deliberately NOT re-exported here:
// server/utils exports are auto-imported, and a re-export duplicates the
// shared module's own auto-import.)

export const recurringPrefsKey = (owner: string, planId: string) => `recurring:${owner}:${planId}`

export function defaultRecurringPrefs (): RecurringPrefs {
  return { confirmed: [], dismissed: [], custom: [], startingBalance: null, accounts: { excluded: [], overrides: {}, manual: [] } }
}

const MAX_ACCOUNTS = 50
const MAX_MILLI = 1_000_000_000_000

function cleanAccounts (value: unknown): AccountPrefs {
  const input = (value ?? {}) as Record<string, unknown>
  const overrides: Record<string, number> = {}
  if (input.overrides && typeof input.overrides === 'object') {
    for (const [id, amount] of Object.entries(input.overrides as Record<string, unknown>).slice(0, MAX_ACCOUNTS)) {
      if (id.length > 60 || typeof amount !== 'number' || !Number.isFinite(amount) || Math.abs(amount) > MAX_MILLI) continue
      overrides[id] = Math.round(amount)
    }
  }
  const manual: ManualAccount[] = []
  if (Array.isArray(input.manual)) {
    for (const raw of input.manual.slice(0, MAX_ACCOUNTS)) {
      const item = raw as Record<string, unknown>
      const name = typeof item.name === 'string' ? item.name.trim().slice(0, 80) : ''
      const kind = item.kind === 'credit' ? 'credit' : 'cash'
      const balance = typeof item.balance === 'number' && Number.isFinite(item.balance) ? Math.round(item.balance) : NaN
      if (!name || !Number.isFinite(balance) || Math.abs(balance) > MAX_MILLI) continue
      manual.push({
        id: typeof item.id === 'string' && item.id.length <= 60 ? item.id : crypto.randomUUID(),
        name,
        kind,
        balance: kind === 'credit' ? -Math.abs(balance) : Math.abs(balance)
      })
    }
  }
  return { excluded: cleanKeys(input.excluded).slice(0, MAX_ACCOUNTS), overrides, manual }
}

const MAX_KEYS = 200
const MAX_CUSTOM = 100

function cleanKeys (value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= 200)
    .slice(0, MAX_KEYS)
}

export function validateRecurringPrefs (body: unknown): RecurringPrefs {
  const input = (body ?? {}) as Record<string, unknown>
  const custom: CustomMonthly[] = []
  if (Array.isArray(input.custom)) {
    for (const raw of input.custom.slice(0, MAX_CUSTOM)) {
      const item = raw as Record<string, unknown>
      const name = typeof item.name === 'string' ? item.name.trim().slice(0, 80) : ''
      const amount = typeof item.amount === 'number' && Number.isFinite(item.amount) ? Math.round(item.amount) : NaN
      const day = typeof item.day === 'number' ? Math.round(item.day) : NaN
      const kind = item.kind === 'income' ? 'income' : 'bill'
      if (!name || !Number.isFinite(amount) || Math.abs(amount) > 1_000_000_000_000) continue
      if (!Number.isInteger(day) || day < 1 || day > 31) continue
      custom.push({
        id: typeof item.id === 'string' && item.id.length <= 60 ? item.id : crypto.randomUUID(),
        name,
        amount: kind === 'bill' ? -Math.abs(amount) : Math.abs(amount),
        day,
        kind
      })
    }
  }
  const startingBalance = typeof input.startingBalance === 'number' && Number.isFinite(input.startingBalance)
    ? Math.round(input.startingBalance)
    : null
  return {
    confirmed: cleanKeys(input.confirmed),
    dismissed: cleanKeys(input.dismissed),
    custom,
    startingBalance,
    accounts: cleanAccounts(input.accounts)
  }
}
