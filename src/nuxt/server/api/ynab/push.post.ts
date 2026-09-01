// ============================================================================
// Sync-to-YNAB: ONE write action per request, so the client can show honest
// per-action progress and stay gentle with YNAB's 200-requests/hour budget.
//
// Supported (verified against YNAB's OpenAPI spec):
//   update       PATCH /plans/{p}/months/{m}/categories/{c}  { budgeted }
//   set-goal     PATCH /plans/{p}/categories/{c}             { goal_target }
//   set-target   PATCH /plans/{p}/categories/{c}             { goal_target, goal_frequency | goal_target_date, goal_needs_whole_amount } — null removes
//   rename       PATCH /plans/{p}/categories/{c}             { name }
//   move         PATCH /plans/{p}/categories/{c}             { category_group_id }
//   create-group POST  /plans/{p}/category_groups            { name } → id
//   create-cat   POST  /plans/{p}/categories                 { name, group, goal_target? } → id
//
// NOT in YNAB's API (the client lists these as "stays local"): hiding/removing
// categories, and moving a category between budgets.
//
// `finalize: true` on the last call re-snapshots the source so the local copy
// matches what was just written, and records the sync stamp.
// ============================================================================

type PushAction =
  | { kind: 'update', categoryId: string, budgeted: number }
  | { kind: 'rename', categoryId: string, name: string }
  | { kind: 'move', categoryId: string, groupId: string }
  | { kind: 'create-group', name: string }
  | { kind: 'create-cat', name: string, groupId: string, goalTarget?: number | null }
  | { kind: 'set-goal', categoryId: string, goalTarget: number }
  | {
    kind: 'set-target', categoryId: string,
    goalTarget: number | null,               // null removes the target
    frequency?: 'monthly' | 'weekly' | 'yearly' | null,
    targetDate?: string | null,              // ISO date; exclusive with frequency
    needsWholeAmount?: boolean | null        // NEED only: set-aside vs refill
  }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MONTH_RE = /^\d{4}-\d{2}-01$/

function cleanName (value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name || name.length > 100) {
    throw createError({ statusCode: 400, statusMessage: 'Names must be 1–100 characters' })
  }
  return name
}

function cleanAmount (value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) {
    throw createError({ statusCode: 400, statusMessage: 'Amount out of range' })
  }
  return Math.round(value)
}

function cleanUuid (value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${label} must be a YNAB id` })
  }
  return value
}

export default defineEventHandler(async (event) => {
  const { ynabMock } = useRuntimeConfig()
  const body = await readBody<{ sourceId?: string, month?: string, action?: PushAction, finalize?: boolean }>(event)

  if (ynabMock) {
    // Demo mode: the flow plays out, nothing is written anywhere.
    return { ok: true, mocked: true, createdId: crypto.randomUUID() }
  }

  const owner = await requireDebtOwner(event)
  const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : ''
  const source = await getPlanSource(owner, sourceId)
  if (!source || source.kind !== 'synced' || !source.ynabPlanId) {
    throw createError({ statusCode: 400, statusMessage: 'Only budgets synced from YNAB can push back' })
  }
  const pat = await resolvePat(event)
  if (!pat) throw createError({ statusCode: 400, statusMessage: 'Save a YNAB token first' })

  const plan = source.ynabPlanId
  const action = body?.action
  let createdId: string | null = null

  try {
    switch (action?.kind) {
      case 'update': {
        const month = MONTH_RE.test(body?.month ?? '') ? body!.month : null
        if (!month) throw createError({ statusCode: 400, statusMessage: 'A month is required for budget updates' })
        const categoryId = cleanUuid(action.categoryId, 'category')
        await ynabApi(pat, `/plans/${plan}/months/${month}/categories/${categoryId}`, {
          method: 'PATCH',
          body: { category: { budgeted: cleanAmount(action.budgeted) } }
        })
        break
      }
      case 'set-goal': {
        // Makes the draft the category's actual goal target (simple monthly
        // goals only — the client gates which categories offer this).
        const categoryId = cleanUuid(action.categoryId, 'category')
        await ynabApi(pat, `/plans/${plan}/categories/${categoryId}`, {
          method: 'PATCH',
          body: { category: { goal_target: cleanAmount(action.goalTarget) } }
        })
        break
      }
      case 'set-target': {
        // The full target vocabulary the API can express: recurring NEED
        // (weekly/monthly/yearly, set-aside or refill), by-date, or removal.
        const categoryId = cleanUuid(action.categoryId, 'category')
        const category: Record<string, unknown> = {}
        if (action.goalTarget === null) {
          category.goal_target = null
        } else {
          category.goal_target = cleanAmount(action.goalTarget)
          if (action.frequency) {
            if (!['monthly', 'weekly', 'yearly'].includes(action.frequency)) {
              throw createError({ statusCode: 400, statusMessage: 'Target cadence must be monthly, weekly, or yearly' })
            }
            if (action.targetDate) {
              throw createError({ statusCode: 400, statusMessage: 'A target has either a cadence or a date, not both' })
            }
            category.goal_frequency = action.frequency
          } else if (action.targetDate) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(action.targetDate)) {
              throw createError({ statusCode: 400, statusMessage: 'Target date must be an ISO date' })
            }
            category.goal_target_date = action.targetDate
          }
          if (typeof action.needsWholeAmount === 'boolean') {
            category.goal_needs_whole_amount = action.needsWholeAmount
          }
        }
        await ynabApi(pat, `/plans/${plan}/categories/${categoryId}`, {
          method: 'PATCH',
          body: { category }
        })
        break
      }
      case 'rename': {
        const categoryId = cleanUuid(action.categoryId, 'category')
        await ynabApi(pat, `/plans/${plan}/categories/${categoryId}`, {
          method: 'PATCH',
          body: { category: { name: cleanName(action.name) } }
        })
        break
      }
      case 'move': {
        const categoryId = cleanUuid(action.categoryId, 'category')
        await ynabApi(pat, `/plans/${plan}/categories/${categoryId}`, {
          method: 'PATCH',
          body: { category: { category_group_id: cleanUuid(action.groupId, 'group') } }
        })
        break
      }
      case 'create-group': {
        const res = await ynabApi<{ category_group?: { id?: string } }>(pat, `/plans/${plan}/category_groups`, {
          method: 'POST',
          body: { category_group: { name: cleanName(action.name) } }
        })
        createdId = res.category_group?.id ?? null
        break
      }
      case 'create-cat': {
        const category: Record<string, unknown> = {
          name: cleanName(action.name),
          category_group_id: cleanUuid(action.groupId, 'group')
        }
        if (typeof action.goalTarget === 'number' && action.goalTarget > 0) {
          category.goal_target = cleanAmount(action.goalTarget)
        }
        const res = await ynabApi<{ category?: { id?: string } }>(pat, `/plans/${plan}/categories`, {
          method: 'POST',
          body: { category }
        })
        createdId = res.category?.id ?? null
        break
      }
      default:
        throw createError({ statusCode: 400, statusMessage: 'Unknown sync action' })
    }
  } catch (cause: unknown) {
    const err = cause as { statusCode?: number, statusMessage?: string, data?: { error?: { detail?: string } } }
    if (err.statusCode === 400 && err.statusMessage) throw cause as Error
    throw createError({
      statusCode: 502,
      statusMessage: err.data?.error?.detail
        ? `YNAB said: ${err.data.error.detail}`
        : 'YNAB rejected that action — nothing after it was written'
    })
  }

  if (body?.finalize) {
    // Pull the fresh truth back down so the local copy matches what we wrote.
    try {
      const live = (await ynabApi<{ plans: Array<{ id: string, name: string, currency_format?: { iso_code: string, currency_symbol: string } | null }> }>(pat, '/plans')).plans
      const planMeta = live.find(p => p.id === plan)
      if (planMeta) {
        const snapshot = await snapshotYnabPlan(pat, planMeta)
        await saveSnapshot(owner, source.id, snapshot)
        await upsertPlanSource({
          id: source.id,
          userId: owner,
          name: planMeta.name,
          monthCount: snapshot.months.length,
          kind: 'synced',
          ynabPlanId: plan,
          currencyCode: planMeta.currency_format?.iso_code ?? source.currencyCode,
          lastSyncedAt: snapshot.syncedAt ?? new Date().toISOString()
        })
        await recordSync(owner)
      }
    } catch { /* the write landed; a stale snapshot just means "re-sync soon" */ }
  }

  return { ok: true, createdId }
})
