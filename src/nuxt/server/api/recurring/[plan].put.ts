import { recurringPrefsKey, validateRecurringPrefs } from '../../utils/recurring-prefs'

export default defineEventHandler(async (event) => {
  const owner = await requireDebtOwner(event)
  const planId = getRouterParam(event, 'plan')!
  const body = await readBody(event)
  const prefs = validateRecurringPrefs(body)
  await kv.set(recurringPrefsKey(owner, planId), prefs)
  return { ok: true }
})
