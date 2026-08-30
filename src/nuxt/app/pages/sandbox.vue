<script setup lang="ts">
import type { Category, MonthDetail, MonthSummary, PlanSummary } from '#shared/types/ynab'

const plans = ref<PlanSummary[]>([])
const planId = ref('')
const months = ref<MonthSummary[]>([])
const month = ref('')
const detail = ref<MonthDetail | null>(null)
const loading = ref(true)
const connectError = ref(false)
const isMock = ref(false)

const plan = computed(() => plans.value.find(item => item.id === planId.value))

onMounted(async () => {
  try {
    const status = await $fetch<{ mock: boolean }>('/api/ynab/status')
    isMock.value = status.mock
    const data = await $fetch<{ plans: PlanSummary[], default_plan: PlanSummary | null }>('/api/ynab/plans')
    plans.value = data.plans
    planId.value = (data.default_plan ?? data.plans[0])?.id ?? ''
  } catch {
    connectError.value = true
    loading.value = false
  }
})

watch(planId, async (id) => {
  if (!id) return
  loading.value = true
  detail.value = null
  try {
    const data = await $fetch<{ months: MonthSummary[] }>(`/api/ynab/${id}/months`)
    months.value = data.months
    month.value = defaultMonth(data.months)
  } catch {
    connectError.value = true
    loading.value = false
  }
})

watch(month, async (value) => {
  if (!value || !planId.value) return
  loading.value = true
  detail.value = null
  try {
    const data = await $fetch<{ month: MonthDetail }>(`/api/ynab/${planId.value}/months/${value}`)
    detail.value = data.month
    connectError.value = false
  } catch {
    connectError.value = true
  } finally {
    loading.value = false
  }
})

// Months arrive sorted newest-first; pick the current month, else the latest past one.
function defaultMonth (list: MonthSummary[]) {
  const today = `${new Date().toISOString().slice(0, 7)}-01`
  return (list.find(item => item.month <= today) ?? list[0])?.month ?? ''
}

const { drafts, setDraft, clearDraft, resetAll } = useSandboxDrafts(() => `${planId.value}:${month.value}`)

type GroupRow = { name: string, categories: Category[] }

const groups = computed<GroupRow[]>(() => {
  const rows: GroupRow[] = []
  const byName = new Map<string, GroupRow>()
  for (const category of detail.value?.categories ?? []) {
    if (category.hidden || category.deleted || category.internal) continue
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
})

const visibleCategories = computed(() => groups.value.flatMap(group => group.categories))

const draftFor = (category: Category) => drafts.value[category.id] ?? category.budgeted
const deltaFor = (category: Category) => draftFor(category) - category.budgeted
const projectedBalance = (category: Category) => category.balance + deltaFor(category)

const changes = computed(() =>
  visibleCategories.value.filter(category => deltaFor(category) !== 0)
)

const totalDelta = computed(() =>
  changes.value.reduce((sum, category) => sum + deltaFor(category), 0)
)

const assignedLive = computed(() =>
  visibleCategories.value.reduce((sum, category) => sum + category.budgeted, 0)
)
const assignedDraft = computed(() => assignedLive.value + totalDelta.value)
const activityTotal = computed(() =>
  visibleCategories.value.reduce((sum, category) => sum + category.activity, 0)
)
const projectedToBeBudgeted = computed(() => (detail.value?.to_be_budgeted ?? 0) - totalDelta.value)

const groupAssigned = (group: GroupRow) => group.categories.reduce((sum, category) => sum + draftFor(category), 0)
const groupActivity = (group: GroupRow) => group.categories.reduce((sum, category) => sum + category.activity, 0)

const formatter = computed(() => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: plan.value?.currency_format?.iso_code || 'USD'
}))
const fmt = (milliunits: number) => formatter.value.format(milliunits / 1000)
const fmtDelta = (milliunits: number) => `${milliunits > 0 ? '+' : '−'}${fmt(Math.abs(milliunits))}`

const inputValue = (category: Category) => Number((draftFor(category) / 1000).toFixed(2))

function onAmountChange (category: Category, event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const parsed = Number.parseFloat(raw)
  if (Number.isNaN(parsed)) {
    clearDraft(category.id)
    return
  }
  setDraft(category.id, Math.round(parsed * 1000), category.budgeted)
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
  return `${target} / month`
}

const monthLabel = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
</script>

<template>
  <main class="page">
    <header class="top">
      <div>
        <h1><NuxtLink to="/">YNABRR</NuxtLink> <span class="crumb">/ Sandbox</span></h1>
        <p class="tagline">Draft reallocations locally — nothing changes in YNAB until you sync.</p>
      </div>
      <div class="pickers">
        <span v-if="isMock" class="badge" title="Serving built-in fixtures — no YNAB account is being read">Mock data</span>
        <select v-if="plans.length > 1" v-model="planId" aria-label="Plan">
          <option v-for="item in plans" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
        <select v-if="months.length" v-model="month" aria-label="Month">
          <option v-for="item in months" :key="item.month" :value="item.month">{{ monthLabel(item.month) }}</option>
        </select>
      </div>
    </header>

    <section v-if="connectError" class="status">
      <h2>Not connected</h2>
      <p>
        Copy <code>.env.example</code> to <code>.env</code> and set
        <code>NUXT_YNAB_PERSONAL_ACCESS_TOKEN</code> with a token from
        <a href="https://app.ynab.com/settings/developer">YNAB → Account Settings → Developer</a>,
        then restart the dev server. Or run <code>make up-mock</code> to play with sample data.
      </p>
    </section>

    <p v-else-if="loading || !detail" class="status">Loading plan…</p>

    <template v-else>
      <section class="stats">
        <article>
          <h3>Income</h3>
          <p>{{ fmt(detail.income) }}</p>
        </article>
        <article>
          <h3>Assigned</h3>
          <p>{{ fmt(assignedDraft) }}</p>
          <p v-if="totalDelta !== 0" class="sub">was {{ fmt(assignedLive) }}</p>
        </article>
        <article>
          <h3>Activity</h3>
          <p>{{ fmt(activityTotal) }}</p>
        </article>
        <article :class="{ negative: projectedToBeBudgeted < 0 }">
          <h3>Ready to Assign</h3>
          <p>{{ fmt(projectedToBeBudgeted) }}</p>
          <p v-if="totalDelta !== 0" class="sub">was {{ fmt(detail.to_be_budgeted) }}</p>
        </article>
      </section>

      <section class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="name">Category</th>
              <th class="goal">Goal</th>
              <th class="num">Activity</th>
              <th class="num">Assigned</th>
              <th class="num">Sandbox</th>
              <th class="num">Available</th>
            </tr>
          </thead>
          <tbody v-for="group in groups" :key="group.name">
            <tr class="group-row">
              <th colspan="2">{{ group.name }}</th>
              <td class="num">{{ fmt(groupActivity(group)) }}</td>
              <td class="num">{{ fmt(groupAssigned(group)) }}</td>
              <td colspan="2" />
            </tr>
            <tr v-for="category in group.categories" :key="category.id" :class="{ changed: deltaFor(category) !== 0 }">
              <td class="name">{{ category.name }}</td>
              <td class="goal">
                <template v-if="goalLabel(category)">
                  <span>{{ goalLabel(category) }}</span>
                  <span v-if="category.goal_percentage_complete != null" class="goal-bar">
                    <i :style="{ width: `${Math.min(category.goal_percentage_complete, 100)}%` }" />
                  </span>
                </template>
              </td>
              <td class="num">{{ fmt(category.activity) }}</td>
              <td class="num muted">{{ fmt(category.budgeted) }}</td>
              <td class="num sandbox-cell">
                <input
                  type="number"
                  step="0.01"
                  :value="inputValue(category)"
                  :aria-label="`Sandbox amount for ${category.name}`"
                  @change="onAmountChange(category, $event)"
                >
                <button
                  v-if="deltaFor(category) !== 0"
                  class="reset"
                  :title="`Reset to ${fmt(category.budgeted)}`"
                  @click="clearDraft(category.id)"
                >↺</button>
                <span v-if="deltaFor(category) !== 0" class="delta">{{ fmtDelta(deltaFor(category)) }}</span>
              </td>
              <td class="num" :class="{ overspent: projectedBalance(category) < 0 }">
                {{ fmt(projectedBalance(category)) }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer v-if="changes.length" class="changebar">
        <p>
          <strong>{{ changes.length }} {{ changes.length === 1 ? 'change' : 'changes' }}</strong>
          · net assigned {{ fmtDelta(totalDelta) }}
          · Ready to Assign {{ fmt(detail.to_be_budgeted) }} → <strong>{{ fmt(projectedToBeBudgeted) }}</strong>
        </p>
        <div class="actions">
          <button class="ghost" @click="resetAll">Reset all</button>
          <button class="primary" disabled title="Sync back to YNAB is coming next">Sync to YNAB (soon)</button>
        </div>
      </footer>
    </template>
  </main>
</template>

<style scoped>
.page {
  max-width: 64rem;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 6rem;
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
.tagline { margin: 0.25rem 0 0; color: #666; }

.pickers {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.pickers select {
  padding: 0.4rem 0.6rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  font: inherit;
}

.badge {
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: #fff3cd;
  border: 1px solid #ffe08a;
  color: #7a5d00;
  font-size: 0.8rem;
}

.status {
  margin: 2rem 0;
  padding: 1rem 1.25rem;
  border: 1px solid #ddd;
  border-radius: 8px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 1rem;
  margin: 1.5rem 0;
}

.stats article {
  padding: 0.9rem 1.1rem;
  border: 1px solid #ddd;
  border-radius: 8px;
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

.table-wrap { overflow-x: auto; }

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.925rem;
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

td, tbody th {
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid #eee;
}

.group-row th {
  text-align: left;
  padding-top: 1.1rem;
  font-size: 0.85rem;
}

.group-row td {
  padding-top: 1.1rem;
  color: #888;
  font-size: 0.85rem;
}

th.num, td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.muted { color: #999; }
.overspent { color: #b3261e; font-weight: 600; }

tr.changed { background: #f2f7ff; }

.goal { color: #777; font-size: 0.8rem; }

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
  border: 1px solid #ccc;
  border-radius: 6px;
  font: inherit;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

tr.changed .sandbox-cell input { border-color: #4a7dff; }

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
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.5rem;
  background: #fff;
  border-top: 1px solid #ddd;
  box-shadow: 0 -4px 16px rgb(0 0 0 / 6%);
}

.changebar p { margin: 0; }

.actions { display: flex; gap: 0.5rem; }

.actions button {
  padding: 0.45rem 0.9rem;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.actions .ghost {
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
