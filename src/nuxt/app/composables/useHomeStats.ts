import type { Category, MonthDetail, MonthSummary, PlanSummary } from '#shared/types/ynab'

// Home's tiles quote real figures. Budget numbers have to be computed on the
// client because the plan selection (and the sandbox's what-if drafts) live in
// localStorage — the server can't see them. We deliberately read the BASELINE
// here, not the draft scenario: Home is a dashboard, not a what-if.
const SELECTED_KEY = 'ynabrr:sandbox:selected-plans'

export type DebtRow = {
  balance: number
  paidIn: number
  userPaidIn: number | null
  hidden: boolean
  history: unknown[]
}

export function useHomeStats () {
  const leftOver = ref<number | null>(null)
  const billsDue = ref<number | null>(null)
  const paidDown = ref<number | null>(null)
  const debtsClosed = ref<number | null>(null)
  const debtsTotal = ref<number | null>(null)
  const planCount = ref(0)
  const planNames = ref<string[]>([])
  const lastSynced = ref<string | null>(null)
  const month = ref('')

  function defaultMonth (options: string[]) {
    const today = `${new Date().toISOString().slice(0, 7)}-01`
    return options.find(item => item <= today) ?? options[0] ?? ''
  }

  async function loadBudget () {
    const data = await $fetch<{ plans: PlanSummary[], default_plan: PlanSummary | null }>('/api/ynab/plans')
    planCount.value = data.plans.length
    if (!data.plans.length) return

    // Mirror Tinkrr's selection so the two surfaces never disagree.
    let stored: string[] = []
    try {
      stored = JSON.parse(localStorage.getItem(SELECTED_KEY) ?? '[]')
    } catch { /* fall through to the default plan */ }
    const valid = stored.filter(id => data.plans.some(p => p.id === id))
    const fallback = (data.default_plan ?? data.plans[0])?.id
    const ids = valid.length ? valid : (fallback ? [fallback] : [])
    if (!ids.length) return

    planNames.value = ids
      .map(id => data.plans.find(p => p.id === id)?.name)
      .filter((n): n is string => Boolean(n))

    const monthsByPlan = await Promise.all(ids.map(async (id) => {
      const res = await $fetch<{ months: MonthSummary[] }>(`/api/ynab/${id}/months`)
      return { id, months: res.months }
    }))
    const keys = new Set<string>()
    for (const entry of monthsByPlan) for (const m of entry.months) keys.add(m.month)
    month.value = defaultMonth([...keys].sort((a, b) => b.localeCompare(a)))
    if (!month.value) return

    const details = await Promise.all(ids.map(async (id) => {
      // The detail is nested under `month`; an archived plan (or one with no
      // row for this month) resolves to null.
      try {
        const res = await $fetch<{ month: MonthDetail | null }>(`/api/ynab/${id}/months/${month.value}`)
        return res.month
      } catch { return null }
    }))

    let income = 0
    let required = 0
    let due = 0
    let loaded = false
    for (const detail of details) {
      if (!detail) continue
      loaded = true
      income += detail.income ?? 0
      const cats: Category[] = (detail.categories ?? []).filter(isGoalCategory)
      for (const category of cats) {
        required += goalMonthlyFor(category, month.value)
        if (isDueInMonth(category, month.value)) due++
      }
    }
    // Nothing loaded means "unknown", not "zero" — leave the tiles bare rather
    // than quoting a $0.00 that isn't true.
    if (!loaded) return
    leftOver.value = income - required
    billsDue.value = due
  }

  async function loadDebt () {
    const data = await $fetch<{ debts: DebtRow[], lastSynced: string | null }>('/api/debt')
    lastSynced.value = data.lastSynced
    // Match Debt Colectrr: only loans with real history count, balances are
    // negative while owed, and a non-negative balance means it's paid off.
    const visible = data.debts.filter(d => !d.hidden && d.history.length > 0)
    debtsTotal.value = visible.length
    debtsClosed.value = visible.filter(d => d.balance >= 0).length
    paidDown.value = visible.reduce((sum, d) => sum + (d.userPaidIn ?? d.paidIn ?? 0), 0)
  }

  async function load () {
    // Independent surfaces — one failing shouldn't blank the other.
    await Promise.allSettled([loadBudget(), loadDebt()])
  }

  return { leftOver, billsDue, paidDown, debtsClosed, debtsTotal, planCount, planNames, lastSynced, month, load }
}
