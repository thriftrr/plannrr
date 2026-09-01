import { defaultRecurringPrefs, recurringPrefsKey } from '../../utils/recurring-prefs'

// Per-source recurring preferences: suggestion promotions/dismissals, custom
// monthly transactions, and the manual starting balance for sources without
// a register.
export default defineEventHandler(async (event) => {
  const owner = await debtOwner(event)
  const planId = getRouterParam(event, 'plan')!
  if (!owner) return defaultRecurringPrefs()
  return await kv.get(recurringPrefsKey(owner, planId)) ?? defaultRecurringPrefs()
})
