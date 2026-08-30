<script setup lang="ts">
import type { Category, MonthDetail, MonthSummary, PlanSummary } from '#shared/types/ynab'

const plans = ref<PlanSummary[]>([])
const selectedPlanIds = ref<string[]>([])
const monthsByPlan = ref<Record<string, MonthSummary[]>>({})
const month = ref('')
const detailsByPlan = ref<Record<string, MonthDetail | null>>({})
const loading = ref(true)
const connectError = ref(false)
const isMock = ref(false)

const INTRO_KEY = 'ynabrr:sandbox:intro'
const SELECTED_KEY = 'ynabrr:sandbox:selected-plans'
const COLLAPSED_PLANS_KEY = 'ynabrr:sandbox:collapsed-plans'
const COLLAPSED_GROUPS_KEY = 'ynabrr:sandbox:collapsed-groups'
const showIntro = ref(false)
const showChanges = ref(false)
const filter = ref('')
const collapsedPlans = ref<Record<string, boolean>>({})
const collapsedGroups = ref<Record<string, boolean>>({})

onMounted(async () => {
  try {
    showIntro.value = localStorage.getItem(INTRO_KEY) !== 'dismissed'
    collapsedPlans.value = JSON.parse(localStorage.getItem(COLLAPSED_PLANS_KEY) ?? '{}')
    collapsedGroups.value = JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? '{}')
  } catch {
    showIntro.value = true
  }

  try {
    const status = await $fetch<{ mock: boolean }>('/api/ynab/status')
    isMock.value = status.mock
    const data = await $fetch<{ plans: PlanSummary[], default_plan: PlanSummary | null }>('/api/ynab/plans')
    plans.value = data.plans

    let stored: string[] = []
    try {
      stored = JSON.parse(localStorage.getItem(SELECTED_KEY) ?? '[]')
    } catch { /* fall through to the default selection */ }
    const valid = stored.filter(id => data.plans.some(item => item.id === id))
    const fallback = (data.default_plan ?? data.plans[0])?.id
    selectedPlanIds.value = valid.length ? valid : (fallback ? [fallback] : [])
  } catch {
    connectError.value = true
    loading.value = false
  }
})

function dismissIntro () {
  showIntro.value = false
  try {
    localStorage.setItem(INTRO_KEY, 'dismissed')
  } catch { /* storage blocked — the intro will just reappear next visit */ }
}

function togglePlan (id: string) {
  const current = selectedPlanIds.value
  if (current.includes(id)) {
    if (current.length === 1) return // always keep at least one budget selected
    selectedPlanIds.value = current.filter(item => item !== id)
  } else {
    // keep the picker's order, not click order
    selectedPlanIds.value = plans.value.map(item => item.id).filter(pid => current.includes(pid) || pid === id)
  }
}

watch(selectedPlanIds, (ids) => {
  if (!import.meta.client || !ids.length) return
  try {
    localStorage.setItem(SELECTED_KEY, JSON.stringify(ids))
  } catch { /* storage blocked — selection just won't persist */ }
})

watch(collapsedPlans, (value) => {
  if (!import.meta.client) return
  try {
    localStorage.setItem(COLLAPSED_PLANS_KEY, JSON.stringify(value))
  } catch { /* storage blocked — accordion state just won't persist */ }
}, { deep: true })

watch(collapsedGroups, (value) => {
  if (!import.meta.client) return
  try {
    localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(value))
  } catch { /* storage blocked — accordion state just won't persist */ }
}, { deep: true })

// Months arrive per plan; the picker offers the union across selected plans.
const monthOptions = computed(() => {
  const keys = new Set<string>()
  for (const id of selectedPlanIds.value) {
    for (const item of monthsByPlan.value[id] ?? []) keys.add(item.month)
  }
  return [...keys].sort((a, b) => b.localeCompare(a))
})

function defaultMonth (options: string[]) {
  const today = `${new Date().toISOString().slice(0, 7)}-01`
  return options.find(item => item <= today) ?? options[0] ?? ''
}

watch(selectedPlanIds, async (ids) => {
  if (!ids.length) return
  try {
    const missing = ids.filter(id => !monthsByPlan.value[id])
    await Promise.all(missing.map(async (id) => {
      const data = await $fetch<{ months: MonthSummary[] }>(`/api/ynab/${id}/months`)
      monthsByPlan.value[id] = data.months
    }))
    if (!month.value || !monthOptions.value.includes(month.value)) {
      month.value = defaultMonth(monthOptions.value)
    }
  } catch {
    connectError.value = true
    loading.value = false
  }
})

// Month details are cached per plan+month to stay friendly with YNAB's rate
// limit; a plan without that month (e.g. an archived budget) caches as null.
const detailCache = new Map<string, MonthDetail | null>()
let loadToken = 0

async function loadDetails () {
  if (!month.value || !selectedPlanIds.value.length) return
  const token = ++loadToken
  loading.value = true
  try {
    const entries = await Promise.all(selectedPlanIds.value.map(async (id) => {
      const key = `${id}:${month.value}`
      if (!detailCache.has(key)) {
        // When the plan's month list is known and lacks this month (e.g. an
        // archived budget), skip the request instead of asking for a 404.
        const knownMonths = monthsByPlan.value[id]
        if (knownMonths && !knownMonths.some(item => item.month === month.value)) {
          detailCache.set(key, null)
        } else {
          try {
            const data = await $fetch<{ month: MonthDetail }>(`/api/ynab/${id}/months/${month.value}`)
            detailCache.set(key, data.month)
          } catch {
            detailCache.set(key, null)
          }
        }
      }
      return [id, detailCache.get(key) ?? null] as const
    }))
    if (token !== loadToken) return
    detailsByPlan.value = Object.fromEntries(entries)
    connectError.value = false
  } finally {
    if (token === loadToken) loading.value = false
  }
}

watch([selectedPlanIds, month], loadDetails)

const { drafts, disabled, custom, setDraft, clearDraft, setDisabled, addCustom, renameCustom, removeCustom, resetAll } = useSandboxDrafts(() => month.value)

const isCustom = (category: Category) => category.id.startsWith('custom-')

// What-if income lives in the same draft map under a reserved key, so it
// persists, resets, and scopes per month exactly like category drafts.
const INCOME_KEY = '__income__'

// ---- Goal math ------------------------------------------------------------
// Every row shows a true MONTHLY cost, whatever the goal's period:
// - Repeating goals amortize over their cadence: $600 yearly = $50/mo,
//   $90 every 3 months = $30/mo, weekly goals scale by 52/12
// - Save-by-date goals (TB/TBD): remaining amount spread over months left,
//   a transparent pace rather than YNAB's exact on-track math
// - TB with no date: no defined pace, so fall back to what's assigned today

const roundToCent = (milliunits: number) => Math.round(milliunits / 10) * 10

function monthsUntil (from: string, to: string) {
  const [fromYear, fromMonth] = from.split('-').map(Number)
  const [toYear, toMonth] = to.split('-').map(Number)
  return Math.max((toYear! - fromYear!) * 12 + (toMonth! - fromMonth!) + 1, 1)
}

function goalMonthly (category: Category): number {
  if (!category.goal_type) return 0

  const target = category.goal_target ?? 0
  const cadence = category.goal_cadence
  const frequency = Math.max(category.goal_cadence_frequency ?? 1, 1)

  // Repeating goals: goal_target is the amount per period — amortize it.
  if (cadence != null && cadence !== 0) {
    if (cadence === 1) return roundToCent(target / frequency)
    if (cadence === 2) return roundToCent((target * 52) / frequency / 12)
    if (cadence >= 3 && cadence <= 12) return roundToCent(target / (cadence - 1))
    if (cadence === 13) return roundToCent(target / (12 * frequency))
    if (cadence === 14) return roundToCent(target / 24)
  }

  // One-time save-by-date goals: pace over the months left.
  if (category.goal_target_date) {
    const remaining = category.goal_overall_left
      ?? Math.max(target - (category.goal_overall_funded ?? 0), 0)
    const months = monthsUntil(month.value || category.goal_target_date, category.goal_target_date)
    return Math.max(roundToCent(remaining / months), 0)
  }

  if (category.goal_type === 'TB') return category.budgeted

  // MF / DEBT / undated NEED: the target is already a monthly amount.
  return target
}

type GroupRow = { name: string, categories: Category[] }
type PlanSection = { planId: string, planName: string, detail: MonthDetail | null, groups: GroupRow[] }

// Only categories with a goal belong on this page.
function buildGroups (detail: MonthDetail | null): GroupRow[] {
  const rows: GroupRow[] = []
  const byName = new Map<string, GroupRow>()
  for (const category of detail?.categories ?? []) {
    if (category.hidden || category.deleted || category.internal) continue
    if (!category.goal_type) continue
    const groupName = category.category_group_name ?? 'Other'
    if (groupName === 'Internal Master Category' || groupName === 'Hidden Categories') continue
    let row = byName.get(groupName)
    if (!row) {
      row = { name: groupName, categories: [] }
      byName.set(groupName, row)
      rows.push(row)
    }
    row.categories.push(category)
  }
  return rows
}

// What-if rows the user inserted, folded into their plan's groups. They carry
// no goal, so Goal rollups stay anchored while Monthly and Difference move.
function withCustomRows (planId: string, groups: GroupRow[]): GroupRow[] {
  for (const [id, row] of Object.entries(custom.value)) {
    if (row.planId !== planId) continue
    let group = groups.find(item => item.name === row.groupName)
    if (!group) {
      group = { name: row.groupName, categories: [] }
      groups.push(group)
    }
    group.categories.push({
      id,
      category_group_id: 'custom',
      category_group_name: row.groupName,
      name: row.name,
      hidden: false,
      internal: false,
      budgeted: 0,
      activity: 0,
      balance: 0,
      goal_type: null,
      deleted: false
    })
  }
  return groups
}

const sections = computed<PlanSection[]>(() =>
  selectedPlanIds.value.map((id) => {
    const detail = detailsByPlan.value[id] ?? null
    return {
      planId: id,
      planName: plans.value.find(item => item.id === id)?.name ?? 'Budget',
      detail,
      groups: detail ? withCustomRows(id, buildGroups(detail)) : []
    }
  })
)

const multiPlan = computed(() => selectedPlanIds.value.length > 1)
const hasAnyDetail = computed(() => sections.value.some(section => section.detail))

const visibleCategories = computed(() =>
  sections.value.flatMap(section => section.groups.flatMap(group => group.categories))
)

const planNameByCategory = computed(() => {
  const map = new Map<string, string>()
  for (const section of sections.value) {
    for (const group of section.groups) {
      for (const category of group.categories) map.set(category.id, section.planName)
    }
  }
  return map
})

// Category name filter — a view aid only; totals and rollups ignore it, and
// while it's active it overrides the accordions so matches always surface.
const filterNeedle = computed(() => filter.value.trim().toLowerCase())
const filterActive = computed(() => filterNeedle.value !== '')
const matchesFilter = (category: Category) =>
  !filterActive.value ||
  category.name.toLowerCase().includes(filterNeedle.value) ||
  (category.category_group_name ?? '').toLowerCase().includes(filterNeedle.value)
const groupHasMatch = (group: GroupRow) => group.categories.some(matchesFilter)
const sectionHasMatch = (section: PlanSection) => section.groups.some(groupHasMatch)
const anyFilterMatch = computed(() => sections.value.some(sectionHasMatch))

const draftFor = (category: Category) => drafts.value[category.id] ?? goalMonthly(category)
const deltaFor = (category: Category) => draftFor(category) - goalMonthly(category)

// Excluded rows contribute nothing, so their "difference" is the whole goal saved.
const isOff = (category: Category) => Boolean(disabled.value[category.id])
const effectiveMonthly = (category: Category) => isOff(category) ? 0 : draftFor(category)
const effectiveDelta = (category: Category) => effectiveMonthly(category) - goalMonthly(category)

const changes = computed(() =>
  visibleCategories.value.filter(category => !isOff(category) && deltaFor(category) !== 0)
)
const excluded = computed(() => visibleCategories.value.filter(category => isOff(category)))

const totalDelta = computed(() =>
  visibleCategories.value.reduce((sum, category) => sum + effectiveDelta(category), 0)
)

const incomeLive = computed(() =>
  sections.value.reduce((sum, section) => sum + (section.detail?.income ?? 0), 0)
)
const income = computed(() => drafts.value[INCOME_KEY] ?? incomeLive.value)
const incomeDelta = computed(() => income.value - incomeLive.value)

const scenarioActive = computed(() =>
  totalDelta.value !== 0 || incomeDelta.value !== 0 || excluded.value.length > 0
)
const changeCount = computed(() =>
  changes.value.length + excluded.value.length + (incomeDelta.value !== 0 ? 1 : 0)
)

const goalCount = computed(() => visibleCategories.value.filter(category => !isCustom(category)).length)
const includedCount = computed(() =>
  goalCount.value - excluded.value.filter(category => !isCustom(category)).length
)

const requiredBase = computed(() =>
  visibleCategories.value.reduce((sum, category) => sum + goalMonthly(category), 0)
)
const requiredTotal = computed(() => requiredBase.value + totalDelta.value)
const remainingBase = computed(() => incomeLive.value - requiredBase.value)
const remaining = computed(() => income.value - requiredTotal.value)

const groupMonthly = (group: GroupRow) => group.categories.reduce((sum, category) => sum + effectiveMonthly(category), 0)
const groupDelta = (group: GroupRow) => group.categories.reduce((sum, category) => sum + effectiveDelta(category), 0)

// Goal rollups are the stable baseline — edits and exclusions never move them,
// so Goal − Monthly always reconciles with Difference.
const groupGoal = (group: GroupRow) => group.categories.reduce((sum, category) => sum + goalMonthly(category), 0)
const sectionGoal = (section: PlanSection) => section.groups.reduce((sum, group) => sum + groupGoal(group), 0)
const sectionMonthly = (section: PlanSection) => section.groups.reduce((sum, group) => sum + groupMonthly(group), 0)
const sectionDelta = (section: PlanSection) => section.groups.reduce((sum, group) => sum + groupDelta(group), 0)
const sectionCategories = (section: PlanSection) => section.groups.flatMap(group => group.categories)

// Accordion state: a budget with no plan row (single selection) is always open.
const groupKey = (section: PlanSection, group: GroupRow) => `${section.planId}:${group.name}`
const planOpen = (section: PlanSection) => !multiPlan.value || !collapsedPlans.value[section.planId]
const groupOpen = (section: PlanSection, group: GroupRow) => !collapsedGroups.value[groupKey(section, group)]
const togglePlanOpen = (section: PlanSection) => {
  collapsedPlans.value[section.planId] = !collapsedPlans.value[section.planId]
}
const toggleGroupOpen = (section: PlanSection, group: GroupRow) => {
  const key = groupKey(section, group)
  collapsedGroups.value[key] = !collapsedGroups.value[key]
}
const editedCount = (categories: Category[]) =>
  categories.filter(category => !isOff(category) && deltaFor(category) !== 0).length
const offCount = (categories: Category[]) => categories.filter(category => isOff(category)).length

// Include/exclude checkboxes: the group checkbox reflects its categories.
const groupAllOff = (group: GroupRow) => group.categories.every(category => isOff(category))
const groupMixed = (group: GroupRow) => !groupAllOff(group) && group.categories.some(category => isOff(category))
const toggleGroupIncluded = (group: GroupRow) => {
  const turnOff = group.categories.some(category => !isOff(category))
  for (const category of group.categories) setDisabled(category.id, turnOff)
}

const formatter = computed(() => {
  const first = plans.value.find(item => item.id === selectedPlanIds.value[0])
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: first?.currency_format?.iso_code || 'USD'
  })
})
const fmt = (milliunits: number) => formatter.value.format(milliunits / 1000)
const fmtDelta = (milliunits: number) => `${milliunits > 0 ? '+' : '−'}${fmt(Math.abs(milliunits))}`

const toInput = (milliunits: number) => Number((milliunits / 1000).toFixed(2))

function onAmountChange (category: Category, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const parsed = Number.parseFloat(raw)
  if (Number.isNaN(parsed)) {
    clearDraft(category.id)
    return
  }
  setDraft(category.id, Math.round(parsed * 1000), goalMonthly(category))
}

function onAddRow (section: PlanSection, group: GroupRow) {
  const id = addCustom(section.planId, group.name)
  nextTick(() => document.getElementById(`custom-name-${id}`)?.focus())
}

function onCustomNameChange (id: string, event: Event) {
  renameCustom(id, (event.target as HTMLInputElement).value)
}

function onIncomeChange (event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const parsed = Number.parseFloat(raw)
  if (Number.isNaN(parsed)) {
    clearDraft(INCOME_KEY)
    return
  }
  setDraft(INCOME_KEY, Math.round(parsed * 1000), incomeLive.value)
}

// ---- CSV export -----------------------------------------------------------
// Snapshot of the current scenario: one row per category (what-if rows
// included), Monthly holds the effective amount (0 when excluded) so the
// column sums to Required, then Income/Required/Remaining summary rows.

function csvEscape (value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function exportCsv () {
  const money = (milliunits: number) => (milliunits / 1000).toFixed(2)
  const lines = ['Budget,Group,Category,Goal / month,Monthly,Difference,Included']

  for (const section of sections.value) {
    for (const group of section.groups) {
      for (const category of group.categories) {
        lines.push([
          csvEscape(section.planName),
          csvEscape(group.name),
          csvEscape(category.name || 'What-if row'),
          isCustom(category) ? '' : money(goalMonthly(category)),
          money(effectiveMonthly(category)),
          money(effectiveDelta(category)),
          isOff(category) ? 'no' : 'yes'
        ].join(','))
      }
    }
  }

  lines.push('')
  lines.push(['', '', 'Income', '', money(income.value), money(incomeDelta.value), ''].join(','))
  lines.push(['', '', 'Required', money(requiredBase.value), money(requiredTotal.value), money(totalDelta.value), ''].join(','))
  lines.push(['', '', 'Remaining', money(remainingBase.value), money(remaining.value), '', ''].join(','))

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `ynabrr-scenario-${month.value.slice(0, 7)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

// The label shows the goal in its own period; the Monthly column amortizes.
function cadenceLabel (category: Category) {
  const cadence = category.goal_cadence
  const frequency = Math.max(category.goal_cadence_frequency ?? 1, 1)
  if (cadence === 2) return frequency === 1 ? '/ week' : `/ ${frequency} weeks`
  if (cadence != null && cadence >= 3 && cadence <= 12) return `/ ${cadence - 1} months`
  if (cadence === 13) return frequency === 1 ? '/ year' : `/ ${frequency} years`
  if (cadence === 14) return '/ 2 years'
  if (cadence === 1 && frequency > 1) return `/ ${frequency} months`
  return '/ month'
}

function goalLabel (category: Category) {
  if (!category.goal_type || !category.goal_target) return ''
  const target = fmt(category.goal_target)
  if (category.goal_type === 'TBD' && category.goal_target_date) {
    const date = new Date(`${category.goal_target_date}T00:00:00`)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `${target} by ${date}`
  }
  if (category.goal_type === 'TB') return `Build to ${target}`
  return `${target} ${cadenceLabel(category)}`
}

const monthLabel = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
</script>

<template>
  <main class="page">
    <header class="top">
      <div>
        <h1><NuxtLink to="/">YNABRR</NuxtLink> <span class="crumb">/ Sandbox</span></h1>
        <p class="tagline">
          Every goal across your budgets and its monthly cost — tweak the
          amounts and see how the month fits inside your income.
        </p>
      </div>
      <div class="pickers">
        <button v-if="!showIntro" class="howto" @click="showIntro = true">How this works</button>
        <span v-if="isMock" class="badge" title="Serving built-in sample data — no YNAB account is being read">Mock data</span>
        <input
          v-model="filter"
          type="search"
          class="filter-input"
          placeholder="Filter categories…"
          aria-label="Filter categories by name"
          @keyup.escape="filter = ''"
        >
        <select v-if="monthOptions.length" v-model="month" aria-label="Month">
          <option v-for="item in monthOptions" :key="item" :value="item">{{ monthLabel(item) }}</option>
        </select>
        <button
          class="export-btn"
          :disabled="!hasAnyDetail"
          title="Download the current scenario as a CSV"
          @click="exportCsv"
        >Export CSV</button>
      </div>
    </header>

    <div v-if="plans.length > 1" class="plan-picker" role="group" aria-label="Budgets to tinker with">
      <span class="picker-label">Tinkrr with</span>
      <label
        v-for="item in plans"
        :key="item.id"
        class="pill"
        :class="{ on: selectedPlanIds.includes(item.id) }"
      >
        <input
          type="checkbox"
          :checked="selectedPlanIds.includes(item.id)"
          @change="togglePlan(item.id)"
        >
        {{ item.name }}
      </label>
    </div>

    <section v-if="showIntro" class="intro">
      <div>
        <h2>How the sandbox works</h2>
        <ol>
          <li>
            <strong>Pick the budgets to tinker with.</strong> Every category with a goal from
            each selected budget shows up here with its monthly cost, worked out from the goal
            — a $1,200-by-November goal becomes its monthly pace. Categories without goals
            stay off this page.
          </li>
          <li>
            <strong>Tweak the Monthly column — and Income itself.</strong> Type a what-if
            amount and press Enter; the Difference column and the <em>Required</em> and
            <em>Remaining</em> totals reproject instantly. Income adds up across the selected
            budgets — edit it to try one paycheck instead of two. Untick a category or a
            whole group to leave it out of the math, like seeing the month without debt.
          </li>
          <li>
            <strong>Nothing is written to YNAB.</strong> Your draft is saved only in this
            browser, separately for each month — experiment freely and hit Reset any time.
          </li>
        </ol>
      </div>
      <button class="ghost" @click="dismissIntro">Got it</button>
    </section>

    <section v-if="connectError" class="status">
      <h2>Not connected</h2>
      <p>
        Copy <code>.env.example</code> to <code>.env</code> and set
        <code>NUXT_YNAB_PERSONAL_ACCESS_TOKEN</code> with a token from
        <a href="https://app.ynab.com/settings/developer">YNAB → Account Settings → Developer</a>,
        then restart the dev server. Or run <code>make up-mock</code> to play with sample data.
      </p>
    </section>

    <p v-else-if="loading && !hasAnyDetail" class="status">Loading plans…</p>

    <template v-else>
      <section class="stats">
        <article>
          <h3>Income{{ incomeDelta !== 0 ? ' · scenario' : '' }}</h3>
          <p class="income-edit">
            <input
              type="number"
              step="0.01"
              :value="toInput(income)"
              aria-label="What-if income for this month"
              title="Edit to try a what-if income — nothing is sent to YNAB"
              @change="onIncomeChange"
            >
            <button
              v-if="incomeDelta !== 0"
              class="reset"
              :title="`Reset to YNAB's ${fmt(incomeLive)}`"
              @click="clearDraft(INCOME_KEY)"
            >↺</button>
          </p>
          <p class="sub">
            <template v-if="incomeDelta !== 0">YNAB says {{ fmt(incomeLive) }}</template>
            <template v-else-if="multiPlan">across {{ selectedPlanIds.length }} budgets · edit for a what-if</template>
            <template v-else>from YNAB · edit to try a what-if</template>
          </p>
        </article>
        <article>
          <h3>Required{{ totalDelta !== 0 ? ' · scenario' : '' }}</h3>
          <p>{{ fmt(requiredTotal) }}</p>
          <p class="sub">
            <template v-if="excluded.length">{{ includedCount }} of {{ goalCount }} goals counted</template>
            <template v-else>{{ goalCount }} goals</template>
            <template v-if="totalDelta !== 0"> · goals say {{ fmt(requiredBase) }}</template>
            <template v-else> · per month</template>
          </p>
        </article>
        <article :class="{ negative: remaining < 0 }">
          <h3>Remaining{{ scenarioActive ? ' · scenario' : '' }}</h3>
          <p>{{ fmt(remaining) }}</p>
          <p class="sub">
            <template v-if="scenarioActive">was {{ fmt(remainingBase) }}</template>
            <template v-else>income minus required</template>
          </p>
        </article>
      </section>

      <section class="table-wrap">
        <table>
          <colgroup>
            <col>
            <col class="col-goal">
            <col class="col-monthly">
            <col class="col-diff">
          </colgroup>
          <thead>
            <tr>
              <th class="name">Category</th>
              <th class="goal">Goal</th>
              <th class="num scenario sep" title="Your what-if monthly amount — starts at the goal's monthly cost; nothing is sent to YNAB">
                Monthly <span class="th-hint">editable · stays local</span>
              </th>
              <th class="num scenario" title="Your monthly amount minus the goal's monthly cost">
                Difference
              </th>
            </tr>
          </thead>
          <tbody v-for="section in sections" :key="section.planId">
            <tr v-if="multiPlan && (!filterActive || sectionHasMatch(section))" class="plan-row" @click="togglePlanOpen(section)">
              <th>
                <button class="acc-toggle" :aria-expanded="planOpen(section)" @click.stop="togglePlanOpen(section)">
                  <span class="chev" :class="{ open: planOpen(section) }">▸</span>
                  {{ section.planName }}
                </button>
                <span v-if="!planOpen(section) && editedCount(sectionCategories(section))" class="edited-hint">
                  {{ editedCount(sectionCategories(section)) }} edited
                </span>
                <span v-if="!planOpen(section) && offCount(sectionCategories(section))" class="edited-hint off-hint">
                  {{ offCount(sectionCategories(section)) }} off
                </span>
              </th>
              <td class="goal">
                <template v-if="section.detail">{{ fmt(sectionGoal(section)) }} / month</template>
              </td>
              <td class="num scenario sep">{{ section.detail ? fmt(sectionMonthly(section)) : '' }}</td>
              <td class="num scenario" :class="{ emphasized: sectionDelta(section) !== 0 }">
                <template v-if="section.detail">{{ sectionDelta(section) !== 0 ? fmtDelta(sectionDelta(section)) : '—' }}</template>
              </td>
            </tr>
            <tr v-if="!filterActive && !section.detail && planOpen(section)" class="plan-empty">
              <td colspan="4">No data for {{ month ? monthLabel(month) : 'this month' }} in {{ section.planName }}.</td>
            </tr>
            <template v-for="group in section.groups" :key="section.planId + group.name">
              <tr v-if="filterActive ? groupHasMatch(group) : planOpen(section)" class="group-row" @click="toggleGroupOpen(section, group)">
                <th>
                  <label class="row-enable" @click.stop>
                    <input
                      type="checkbox"
                      :checked="!groupAllOff(group)"
                      :indeterminate.prop="groupMixed(group)"
                      :aria-label="`Include ${group.name} in the math`"
                      @change="toggleGroupIncluded(group)"
                    >
                  </label>
                  <button class="acc-toggle" :aria-expanded="groupOpen(section, group)" @click.stop="toggleGroupOpen(section, group)">
                    <span class="chev" :class="{ open: groupOpen(section, group) }">▸</span>
                    {{ group.name }}
                  </button>
                  <span v-if="!groupOpen(section, group) && editedCount(group.categories)" class="edited-hint">
                    {{ editedCount(group.categories) }} edited
                  </span>
                  <span v-if="!groupOpen(section, group) && offCount(group.categories)" class="edited-hint off-hint">
                    {{ offCount(group.categories) }} off
                  </span>
                </th>
                <td class="goal">{{ fmt(groupGoal(group)) }} / month</td>
                <td class="num scenario sep" :class="{ emphasized: groupDelta(group) !== 0 }">
                  {{ fmt(groupMonthly(group)) }}
                </td>
                <td class="num scenario" :class="{ emphasized: groupDelta(group) !== 0 }">
                  {{ groupDelta(group) !== 0 ? fmtDelta(groupDelta(group)) : '—' }}
                </td>
              </tr>
              <tr
                v-for="category in group.categories"
                v-show="filterActive ? matchesFilter(category) : (planOpen(section) && groupOpen(section, group))"
                :key="category.id"
                :class="{ changed: !isOff(category) && deltaFor(category) !== 0, off: isOff(category) }"
              >
                <td class="name">
                  <label class="row-enable" @click.stop>
                    <input
                      type="checkbox"
                      :checked="!isOff(category)"
                      :aria-label="`Include ${category.name} in the math`"
                      @change="setDisabled(category.id, !isOff(category))"
                    >
                  </label>
                  <input
                    v-if="isCustom(category)"
                    :id="`custom-name-${category.id}`"
                    class="name-input"
                    type="text"
                    placeholder="New row…"
                    :value="category.name"
                    aria-label="What-if row name"
                    @change="onCustomNameChange(category.id, $event)"
                  >
                  <span v-else class="name-text">{{ category.name }}</span>
                </td>
                <td class="goal">
                  <span v-if="isCustom(category)" class="goal-hint">what-if row</span>
                  <template v-else>
                    <span>{{ goalLabel(category) }}</span>
                    <span v-if="category.goal_percentage_complete != null" class="goal-bar">
                      <i :style="{ width: `${Math.min(category.goal_percentage_complete, 100)}%` }" />
                    </span>
                  </template>
                </td>
                <td class="num scenario sandbox-cell">
                  <input
                    type="number"
                    step="0.01"
                    :value="toInput(draftFor(category))"
                    :aria-label="`Monthly amount for ${category.name}`"
                    :disabled="isOff(category)"
                    @change="onAmountChange(category, $event)"
                  >
                  <button
                    v-if="isCustom(category)"
                    class="reset"
                    title="Remove this what-if row"
                    @click="removeCustom(category.id)"
                  >✕</button>
                  <button
                    v-else
                    class="reset"
                    :class="{ ghosted: isOff(category) || deltaFor(category) === 0 }"
                    :title="`Reset to the goal's ${fmt(goalMonthly(category))}`"
                    :tabindex="isOff(category) || deltaFor(category) === 0 ? -1 : 0"
                    @click="clearDraft(category.id)"
                  >↺</button>
                </td>
                <td class="num scenario diff" :class="{ active: effectiveDelta(category) !== 0, 'off-diff': isOff(category) }">
                  {{ effectiveDelta(category) !== 0 ? fmtDelta(effectiveDelta(category)) : '—' }}
                </td>
              </tr>
              <tr v-if="!filterActive && planOpen(section) && groupOpen(section, group) && section.detail" class="add-row">
                <td colspan="4">
                  <button class="add-btn" @click="onAddRow(section, group)">+ Add a what-if row</button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <p v-if="!loading && hasAnyDetail && !visibleCategories.length" class="status">
          No categories with goals in the selected budgets this month. Add goals in YNAB and they'll show up here.
        </p>
        <p v-if="filterActive && !anyFilterMatch" class="status">
          No categories match “{{ filter.trim() }}”.
        </p>
      </section>

      <footer v-if="scenarioActive" class="changebar">
        <div v-if="showChanges" class="changes-list">
          <div v-if="incomeDelta !== 0" class="change-row">
            <span class="change-name">Income</span>
            <span class="change-amounts">
              {{ fmt(incomeLive) }} → <strong>{{ fmt(income) }}</strong>
            </span>
            <span class="delta">{{ fmtDelta(incomeDelta) }}</span>
            <button class="reset" :title="`Reset to YNAB's ${fmt(incomeLive)}`" @click="clearDraft(INCOME_KEY)">↺</button>
          </div>
          <div v-for="category in changes" :key="category.id" class="change-row">
            <span class="change-name">
              <template v-if="multiPlan">{{ planNameByCategory.get(category.id) }} · </template>{{ category.category_group_name }} · {{ category.name }}
            </span>
            <span class="change-amounts">
              <template v-if="isCustom(category)">added · <strong>{{ fmt(draftFor(category)) }}</strong></template>
              <template v-else>{{ fmt(goalMonthly(category)) }} → <strong>{{ fmt(draftFor(category)) }}</strong></template>
            </span>
            <span class="delta">{{ fmtDelta(deltaFor(category)) }}</span>
            <button
              v-if="isCustom(category)"
              class="reset"
              title="Remove this what-if row"
              @click="removeCustom(category.id)"
            >✕</button>
            <button
              v-else
              class="reset"
              :title="`Reset to the goal's ${fmt(goalMonthly(category))}`"
              @click="clearDraft(category.id)"
            >↺</button>
          </div>
          <div v-for="category in excluded" :key="`off-${category.id}`" class="change-row off-change">
            <span class="change-name">
              <template v-if="multiPlan">{{ planNameByCategory.get(category.id) }} · </template>{{ category.category_group_name }} · {{ category.name }}
            </span>
            <span class="change-amounts">
              <template v-if="isCustom(category)">what-if row excluded</template>
              <template v-else>excluded · goal {{ fmt(goalMonthly(category)) }}</template>
            </span>
            <span class="delta">{{ isCustom(category) ? '' : fmtDelta(effectiveDelta(category)) }}</span>
            <button class="reset" title="Include again" @click="setDisabled(category.id, false)">↺</button>
          </div>
        </div>
        <div class="changebar-row">
          <p>
            <strong>Draft scenario · {{ changeCount }} {{ changeCount === 1 ? 'change' : 'changes' }}</strong>
            <template v-if="totalDelta !== 0"> · required {{ fmtDelta(totalDelta) }}</template>
            <template v-if="incomeDelta !== 0"> · income {{ fmtDelta(incomeDelta) }}</template>
            · Remaining {{ fmt(remainingBase) }} → <strong>{{ fmt(remaining) }}</strong>
            <span class="local-note">saved in this browser only</span>
          </p>
          <div class="actions">
            <button class="ghost" @click="showChanges = !showChanges">
              {{ showChanges ? 'Hide changes' : 'Review changes' }}
            </button>
            <button class="ghost" @click="resetAll">Reset all</button>
            <button class="primary" disabled title="Pushing these amounts to YNAB is the next feature — nothing is sent today">
              Sync to YNAB — coming soon
            </button>
          </div>
        </div>
      </footer>
    </template>
  </main>
</template>

<style scoped>
.page {
  max-width: 52rem;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 7rem;
  font-family: system-ui, sans-serif;
  line-height: 1.45;
}

.top {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: baseline;
  justify-content: space-between;
}

.top h1 { margin: 0; }
.top h1 a { color: inherit; text-decoration: none; }
.crumb { color: #999; font-weight: 400; }
.tagline { margin: 0.25rem 0 0; color: #666; max-width: 34rem; }

.pickers {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.pickers select {
  padding: 0.4rem 0.6rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  font: inherit;
}

.filter-input {
  width: 12rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  font: inherit;
}

.filter-input:focus {
  border-color: #4a7dff;
  outline: none;
}

.export-btn {
  padding: 0.4rem 0.8rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  font: inherit;
  cursor: pointer;
}

.export-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.howto {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 0.85rem;
  color: #4a7dff;
  cursor: pointer;
  text-decoration: underline;
}

.badge {
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: #fff3cd;
  border: 1px solid #ffe08a;
  color: #7a5d00;
  font-size: 0.8rem;
}

.plan-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-top: 1rem;
}

.picker-label {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #777;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.8rem;
  border: 1px solid #ccc;
  border-radius: 999px;
  background: #fff;
  font-size: 0.875rem;
  cursor: pointer;
  user-select: none;
}

.pill input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.pill.on {
  border-color: #4a7dff;
  background: #eef4ff;
  color: #2b52c7;
}

.intro {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
  margin: 1.5rem 0 0;
  padding: 1rem 1.25rem;
  border: 1px solid #dbe4ff;
  border-radius: 8px;
  background: #f7faff;
}

.intro h2 {
  margin: 0 0 0.4rem;
  font-size: 1rem;
}

.intro ol {
  margin: 0;
  padding-left: 1.2rem;
}

.intro li { margin: 0.3rem 0; }
.intro li:last-child { margin-bottom: 0; }

.status {
  margin: 2rem 0;
  padding: 1rem 1.25rem;
  border: 1px solid #ddd;
  border-radius: 8px;
}

/* Sticky so the totals stay visible while scrolling the table */
.stats {
  position: sticky;
  top: 0;
  z-index: 5;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 1rem;
  margin: 1rem 0 1.5rem;
  padding: 0.75rem 0;
  background: #fff;
  box-shadow: 0 8px 10px -10px rgb(0 0 0 / 25%);
}

.stats article {
  padding: 0.9rem 1.1rem;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
}

.stats h3 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #777;
}

.stats p {
  margin: 0.25rem 0 0;
  font-size: 1.35rem;
  font-variant-numeric: tabular-nums;
}

.stats .sub {
  font-size: 0.8rem;
  color: #999;
}

.stats .negative p { color: #b3261e; }
.stats .negative .sub { color: #999; }

.income-edit {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.income-edit input {
  width: 8.5rem;
  padding: 0.1rem 0.4rem;
  border: 1px solid #b9c9f5;
  border-radius: 6px;
  background: #f7faff;
  font: inherit;
  font-size: 1.35rem;
  text-align: left;
  font-variant-numeric: tabular-nums;
}

.table-wrap { overflow-x: auto; }

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.925rem;
  /* fixed layout + colgroup keep column widths steady as values change */
  table-layout: fixed;
  min-width: 44rem;
}

.col-goal { width: 12.5rem; }
.col-monthly { width: 10.5rem; }
.col-diff { width: 7rem; }

td.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

thead th {
  text-align: left;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #888;
  border-bottom: 2px solid #ddd;
  padding: 0.5rem 0.6rem;
}

.th-hint {
  display: block;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  font-size: 0.72rem;
  color: #7d97e8;
}

td, tbody th {
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid #eee;
}

/* The editable what-if columns get a tint; divider on the first of them */
td.scenario, th.scenario {
  background: #f7faff;
}

td.sandbox-cell,
th.sep,
td.sep {
  border-left: 1px solid #dbe4ff;
}

thead th.scenario { color: #3f6ae0; }

.plan-row, .group-row { cursor: pointer; }

.acc-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-weight: inherit;
  color: inherit;
  cursor: pointer;
}

.chev {
  display: inline-block;
  font-size: 0.7rem;
  color: #999;
  transition: transform 0.15s ease;
}

.chev.open { transform: rotate(90deg); }

.edited-hint {
  margin-left: 0.5rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: #eef4ff;
  color: #3f6ae0;
  font-size: 0.72rem;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  white-space: nowrap;
}

/* Visual hierarchy: budget rows are solid bands, group rows are small-caps
   labels indented one level, category rows indent beneath them. */
.plan-row th, .plan-row td {
  background: #eef1f6;
  border-top: 14px solid #fff;
  border-bottom: 1px solid #d9dee8;
  padding-top: 0.55rem;
  padding-bottom: 0.55rem;
}

.plan-row th {
  text-align: left;
  font-size: 0.95rem;
  font-weight: 700;
  color: #1d2129;
}

.plan-row td {
  font-size: 0.85rem;
  color: #5a6272;
}

.plan-row td.sep { border-left-color: #d3daea; }

.plan-empty td {
  color: #999;
  font-size: 0.85rem;
  font-style: italic;
  padding-left: 1.7rem;
}

.group-row th {
  text-align: left;
  padding: 0.95rem 0.6rem 0.35rem 1.7rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #5f6675;
}

.group-row td {
  padding-top: 0.95rem;
  padding-bottom: 0.35rem;
  color: #888;
  font-size: 0.85rem;
  vertical-align: bottom;
}

td.name { padding-left: 2.4rem; }

.plan-row td.emphasized,
.group-row td.emphasized {
  color: #3f6ae0;
  font-weight: 600;
}

th.num, td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

tr.changed td { background: #eef4ff; }

.goal {
  color: #777;
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-enable {
  display: inline-flex;
  margin-right: 0.45rem;
  vertical-align: middle;
}

.row-enable input {
  margin: 0;
  accent-color: #4a7dff;
  cursor: pointer;
}

tr.off td { color: #a9b0bf; }
tr.off .goal { color: #b6bcc9; }
tr.off .name-text {
  text-decoration: line-through;
  text-decoration-color: #c4cad6;
}
tr.off .sandbox-cell input {
  color: #a9b0bf;
  background: #f3f5f9;
  border-color: #dde3f0;
}
tr.off .goal-bar i { background: #c3d1f4; }

.name-input {
  width: 11rem;
  max-width: 100%;
  padding: 0.25rem 0.45rem;
  border: 1px solid #b9c9f5;
  border-radius: 6px;
  font: inherit;
  font-size: 0.875rem;
}

.goal-hint {
  font-style: italic;
  color: #a3aabb;
}

.add-row td {
  padding: 0.2rem 0.6rem 0.55rem 2.35rem;
}

.add-btn {
  border: none;
  background: none;
  padding: 0.15rem 0.25rem;
  font: inherit;
  font-size: 0.8rem;
  color: #4a7dff;
  cursor: pointer;
}

.add-btn:hover { text-decoration: underline; }

.reset.ghosted { visibility: hidden; }

.edited-hint.off-hint { background: #f1f2f5; color: #778; }
.off-change .change-amounts { color: #999; }

.goal-bar {
  display: inline-block;
  width: 3.5rem;
  height: 4px;
  margin-left: 0.5rem;
  border-radius: 2px;
  background: #e4e4e4;
  vertical-align: middle;
  overflow: hidden;
}

.goal-bar i {
  display: block;
  height: 100%;
  background: #4a7dff;
}

.sandbox-cell { white-space: nowrap; }

.sandbox-cell input {
  width: 6.5rem;
  padding: 0.3rem 0.45rem;
  border: 1px solid #b9c9f5;
  border-radius: 6px;
  background: #fff;
  font: inherit;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

tr.changed .sandbox-cell input { border-color: #4a7dff; }

td.diff { color: #bbb; }
td.diff.active { color: #3f6ae0; font-weight: 600; }
td.diff.off-diff.active { color: #98a6cf; }

.reset {
  margin-left: 0.35rem;
  border: none;
  background: none;
  cursor: pointer;
  color: #4a7dff;
  font-size: 1rem;
}

.delta {
  display: block;
  font-size: 0.75rem;
  color: #4a7dff;
}

.changebar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: #fff;
  border-top: 1px solid #ddd;
  box-shadow: 0 -4px 16px rgb(0 0 0 / 6%);
}

.changes-list {
  max-height: 40vh;
  overflow-y: auto;
  padding: 0.6rem 1.5rem 0.2rem;
  border-bottom: 1px solid #eee;
}

.change-row {
  display: flex;
  gap: 1rem;
  align-items: baseline;
  padding: 0.25rem 0;
  font-size: 0.875rem;
}

.change-name { flex: 1; }

.change-amounts {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.change-row .delta {
  display: inline;
  min-width: 5rem;
  text-align: right;
}

.change-row .reset { margin-left: 0; }

.changebar-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.5rem;
}

.changebar-row p { margin: 0; }

.local-note {
  margin-left: 0.5rem;
  font-size: 0.8rem;
  color: #999;
}

.actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }

.actions button, .intro .ghost {
  padding: 0.45rem 0.9rem;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.actions .ghost, .intro .ghost {
  border: 1px solid #ccc;
  background: #fff;
}

.actions .primary {
  border: 1px solid #4a7dff;
  background: #4a7dff;
  color: #fff;
}

.actions .primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
