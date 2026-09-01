import type { CustomMonthly, RecurringPrefs } from '#shared/types/recurring'

// Storage + validation for per-source recurring-transaction preferences.
// The shapes live in shared/types/recurring.ts so the client's detection
// engine and this store can never drift. (Deliberately NOT re-exported here:
// server/utils exports are auto-imported, and a re-export duplicates the
// shared module's own auto-import.)

export const recurringPrefsKey = (owner: string, planId: string) => `recurring:${owner}:${planId}`

export function defaultRecurringPrefs (): RecurringPrefs {
  return { confirmed: [], dismissed: [], custom: [], startingBalance: null }
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
    startingBalance
  }
}
