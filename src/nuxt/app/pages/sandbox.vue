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

const INTRO_KEY = 'ynabrr:sandbox:intro'
const showIntro = ref(false)
const showChanges = ref(false)

onMounted(async () => {
  try {
    showIntro.value = localStorage.getItem(INTRO_KEY) !== 'dismissed'
  } catch {
    showIntro.value = true
  }

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

function dismissIntro () {
  showIntro.value = false
  try {
    localStorage.setItem(INTRO_KEY, 'dismissed')
  } catch { /* storage blocked — the intro will just reappear next visit */ }
}

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

// ---- Goal math ------------------------------------------------------------
// Each goal boils down to a monthly requirement:
// - NEED / MF / DEBT goals: goal_target IS the monthly amount
// - TBD (save $X by date): remaining amount spread over the months left,
//   a transparent pace rather than YNAB's exact on-track math
// - TB with no date: no defined pace, so fall back to what's assigned today

function monthsUntil (from: string, to: string) {
  const [fromYear, fromMonth] = from.split('-').map(Number)
  const [toYear, toMonth] = to.split('-').map(Number)
  return Math.max((toYear! - fromYear!) * 12 + (toMonth! - fromMonth!) + 1, 1)
}

function goalMonthly (category: Category): number {
  if (!category.goal_type) return 0
  if (category.goal_type === 'TB' || category.goal_type === 'TBD') {
    if (category.goal_target_date) {
      const target = category.goal_target ?? 0
      const remaining = category.goal_overall_left
        ?? Math.max(target - (category.goal_overall_funded ?? 0), 0)
      const months = monthsUntil(month.value || category.goal_target_date, category.goal_target_date)
      return Math.max(Math.round(remaining / months / 10) * 10, 0)
    }
    return category.budgeted
  }
  return category.goal_target ?? 0
}

type GroupRow = { name: string, categories: Category[] }

// Only categories with a goal belong on this page.
const groups = computed<GroupRow[]>(() => {
  const rows: GroupRow[] = []
  const byName = new Map<string, GroupRow>()
  for (const category of detail.value?.categories ?? []) {
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
})

const visibleCategories = computed(() => groups.value.flatMap(group => group.categories))

const draftFor = (category: Category) => drafts.value[category.id] ?? goalMonthly(category)
const deltaFor = (category: Category) => draftFor(category) - goalMonthly(category)

const changes = computed(() =>
  visibleCategories.value.filter(category => deltaFor(category) !== 0)
)

const totalDelta = computed(() =>
  changes.value.reduce((sum, category) => sum + deltaFor(category), 0)
)

const requiredBase = computed(() =>
  visibleCategories.value.reduce((sum, category) => sum + goalMonthly(category), 0)
)
const requiredTotal = computed(() => requiredBase.value + totalDelta.value)
const remainingBase = computed(() => (detail.value?.income ?? 0) - requiredBase.value)
const remaining = computed(() => (detail.value?.income ?? 0) - requiredTotal.value)

const groupMonthly = (group: GroupRow) => group.categories.reduce((sum, category) => sum + draftFor(category), 0)
const groupMonthlyBase = (group: GroupRow) => group.categories.reduce((sum, category) => sum + goalMonthly(category), 0)

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
  setDraft(category.id, Math.round(parsed * 1000), goalMonthly(category))
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
        <p class="tagline">
          Every goal in your plan and its monthly cost — tweak the amounts and
          see how the month fits inside your income.
        </p>
      </div>
      <div class="pickers">
        <button v-if="!showIntro" class="howto" @click="showIntro = true">How this works</button>
        <span v-if="isMock" class="badge" title="Serving built-in sample data — no YNAB account is being read">Mock data</span>
        <select v-if="plans.length > 1" v-model="planId" aria-label="Plan">
          <option v-for="item in plans" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
        <select v-if="months.length" v-model="month" aria-label="Month">
          <option v-for="item in months" :key="item.month" :value="item.month">{{ monthLabel(item.month) }}</option>
        </select>
      </div>
    </header>

    <section v-if="showIntro" class="intro">
      <div>
        <h2>How the sandbox works</h2>
        <ol>
          <li>
            <strong>Every category with a goal shows up here</strong> with its monthly cost,
            worked out from the goal — a $1,200-by-November goal becomes its monthly pace.
            Categories without goals stay off this page.
          </li>
          <li>
            <strong>Tweak the Monthly column.</strong> Type a what-if amount and press Enter —
            <em>Required</em> and <em>Remaining</em> up top reproject instantly, so you can see
            what fits inside your income and what's left over.
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

    <p v-else-if="loading || !detail" class="status">Loading plan…</p>

    <template v-else>
      <section class="stats">
        <article>
          <h3>Income</h3>
          <p>{{ fmt(detail.income) }}</p>
          <p class="sub">from YNAB this month</p>
        </article>
        <article>
          <h3>Required{{ totalDelta !== 0 ? ' · scenario' : '' }}</h3>
          <p>{{ fmt(requiredTotal) }}</p>
          <p class="sub">
            <template v-if="totalDelta !== 0">goals say {{ fmt(requiredBase) }}</template>
            <template v-else>all goals, per month</template>
          </p>
        </article>
        <article :class="{ negative: remaining < 0 }">
          <h3>Remaining{{ totalDelta !== 0 ? ' · scenario' : '' }}</h3>
          <p>{{ fmt(remaining) }}</p>
          <p class="sub">
            <template v-if="totalDelta !== 0">goals say {{ fmt(remainingBase) }}</template>
            <template v-else>income minus required</template>
          </p>
        </article>
      </section>

      <section class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="name">Category</th>
              <th class="goal">Goal</th>
              <th class="num scenario" title="Your what-if monthly amount — starts at the goal's monthly cost; nothing is sent to YNAB">
                Monthly <span class="th-hint">editable · stays local</span>
              </th>
            </tr>
          </thead>
          <tbody v-for="group in groups" :key="group.name">
            <tr class="group-row">
              <th colspan="2">{{ group.name }}</th>
              <td class="num scenario" :class="{ emphasized: groupMonthly(group) !== groupMonthlyBase(group) }">
                {{ fmt(groupMonthly(group)) }}
              </td>
            </tr>
            <tr v-for="category in group.categories" :key="category.id" :class="{ changed: deltaFor(category) !== 0 }">
              <td class="name">{{ category.name }}</td>
              <td class="goal">
                <span>{{ goalLabel(category) }}</span>
                <span v-if="category.goal_percentage_complete != null" class="goal-bar">
                  <i :style="{ width: `${Math.min(category.goal_percentage_complete, 100)}%` }" />
                </span>
              </td>
              <td class="num scenario sandbox-cell">
                <input
                  type="number"
                  step="0.01"
                  :value="inputValue(category)"
                  :aria-label="`Monthly amount for ${category.name}`"
                  @change="onAmountChange(category, $event)"
                >
                <button
                  v-if="deltaFor(category) !== 0"
                  class="reset"
                  :title="`Reset to the goal's ${fmt(goalMonthly(category))}`"
                  @click="clearDraft(category.id)"
                >↺</button>
                <span v-if="deltaFor(category) !== 0" class="delta">{{ fmtDelta(deltaFor(category)) }} vs goal</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="detail && !visibleCategories.length" class="status">
          No categories with goals in this month. Add goals in YNAB and they'll show up here.
        </p>
      </section>

      <footer v-if="changes.length" class="changebar">
        <div v-if="showChanges" class="changes-list">
          <div v-for="category in changes" :key="category.id" class="change-row">
            <span class="change-name">{{ category.category_group_name }} · {{ category.name }}</span>
            <span class="change-amounts">
              {{ fmt(goalMonthly(category)) }} → <strong>{{ fmt(draftFor(category)) }}</strong>
            </span>
            <span class="delta">{{ fmtDelta(deltaFor(category)) }}</span>
            <button class="reset" :title="`Reset to the goal's ${fmt(goalMonthly(category))}`" @click="clearDraft(category.id)">↺</button>
          </div>
        </div>
        <div class="changebar-row">
          <p>
            <strong>Draft scenario · {{ changes.length }} {{ changes.length === 1 ? 'change' : 'changes' }}</strong>
            · required {{ fmtDelta(totalDelta) }}
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

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
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

/* The editable what-if column gets a tint and a divider from the read-only side */
td.scenario, th.scenario {
  background: #f7faff;
  border-left: 1px solid #dbe4ff;
}

thead th.scenario { color: #3f6ae0; }

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
  border: 1px solid #b9c9f5;
  border-radius: 6px;
  background: #fff;
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
