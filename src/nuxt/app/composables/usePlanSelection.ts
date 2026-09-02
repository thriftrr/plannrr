import type { PlanSummary } from '#shared/types/ynab'

// One budget selection shared by Tinkrr, Calendrr, and the Home tiles — the
// design stores a single selection for the whole app, so we do too.
const SELECTED_KEY = 'ynabrr:sandbox:selected-plans'

export function usePlanSelection () {
  const plans = useState<PlanSummary[]>('plan-sel-plans', () => [])
  const selectedIds = useState<string[]>('plan-sel-ids', () => [])
  const loaded = useState<boolean>('plan-sel-loaded', () => false)
  const patError = useState<boolean>('plan-sel-pat-error', () => false)

  async function load () {
    const data = await $fetch<{ plans: PlanSummary[], default_plan: PlanSummary | null, pat_error?: boolean }>('/api/ynab/plans')
    plans.value = data.plans
    patError.value = Boolean(data.pat_error)

    let stored: string[] = []
    try {
      stored = JSON.parse(localStorage.getItem(SELECTED_KEY) ?? '[]')
    } catch { /* fall through to the default plan */ }
    const valid = stored.filter(id => data.plans.some(p => p.id === id))
    const fallback = (data.default_plan ?? data.plans[0])?.id
    selectedIds.value = valid.length ? valid : (fallback ? [fallback] : [])
    loaded.value = true
  }

  function toggle (id: string) {
    const current = selectedIds.value
    if (current.includes(id)) {
      if (current.length === 1) return // never empty — the design locks the last one
      selectedIds.value = current.filter(x => x !== id)
    } else {
      // keep the master plan order, per the design's picker
      selectedIds.value = plans.value.map(p => p.id).filter(pid => current.includes(pid) || pid === id)
    }
    try {
      localStorage.setItem(SELECTED_KEY, JSON.stringify(selectedIds.value))
    } catch { /* selection still applies for this session */ }
  }

  const selectedPlans = computed(() => selectedIds.value
    .map(id => plans.value.find(p => p.id === id))
    .filter((p): p is PlanSummary => Boolean(p)))

  const label = computed(() => {
    const sel = selectedPlans.value
    if (!sel.length) return 'No plans'
    return sel.length === 1 ? sel[0]!.name : `${sel.length} plans`
  })

  return { plans, selectedIds, selectedPlans, loaded, patError, label, load, toggle }
}
