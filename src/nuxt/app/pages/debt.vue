<script setup lang="ts">
const { user: authUser, refresh: refreshAuth } = useAuth()

// Fixed categorical order (validated against the app surface); color follows
// the debt row, never its rank or the current selection.
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const OVERFLOW_COLORS = ['#8b93a3', '#a8adb8', '#6f7789']

interface DebtRecord {
  id: string
  source: 'ynab' | 'import' | 'manual'
  planName: string
  name: string
  startDate: string
  endDate: string | null
  startBalance: number
  balance: number
  paidIn: number
  rate: number | null
  minimumPayment: number | null
  history: Array<{ month: string, balance: number }>
  hidden: boolean
}

interface LoanRow extends DebtRecord {
  color: string
}

const EXTRAS_KEY = 'ynabrr:debt:extras'
const SYNC_PLANS_KEY = 'ynabrr:debt:sync-plans'

interface DebtSettings {
  strategy: 'separate' | 'snowball'
  snowball: number
  extra: number
  order: 'balance' | 'rate'
}

const debts = ref<DebtRecord[]>([])
const isMock = ref(false)
const loading = ref(true)
const lastSynced = ref<string | null>(null)
const extras = ref<Record<string, number>>({})
const settings = ref<DebtSettings>({ strategy: 'separate', snowball: 0, extra: 0, order: 'balance' })

const syncPlans = ref<Array<{ id: string, name: string, kind: 'live' | 'import' }>>([])
const selectedPlanIds = ref<string[]>([])
const syncing = ref(false)
const syncMessage = ref('')

const adding = ref(false)
const addForm = ref({ name: '', original: '', balance: '0', startMonth: '', endMonth: '', rate: '', payment: '' })
const addMessage = ref('')

onMounted(async () => {
  try {
    extras.value = JSON.parse(localStorage.getItem(EXTRAS_KEY) ?? '{}')
  } catch { /* fresh start */ }

  await refreshAuth()
  await loadDebts()

  if (!isMock.value) {
    try {
      const data = await $fetch<{ plans: typeof syncPlans.value }>('/api/debt/plans')
      syncPlans.value = data.plans
      let stored: string[] = []
      try {
        stored = JSON.parse(localStorage.getItem(SYNC_PLANS_KEY) ?? '[]')
      } catch { /* default below */ }
      const valid = stored.filter(id => data.plans.some(plan => plan.id === id))
      selectedPlanIds.value = valid.length ? valid : data.plans.map(plan => plan.id)
    } catch { /* sync bar just stays empty */ }
  }
  loading.value = false
})

async function loadDebts () {
  try {
    const data = await $fetch<{ mock: boolean, debts: DebtRecord[], lastSynced: string | null, settings?: DebtSettings }>('/api/debt')
    isMock.value = data.mock
    debts.value = data.debts
    lastSynced.value = data.lastSynced
    if (data.settings) settings.value = data.settings
  } catch { /* empty state */ }
}

async function saveSettings (patch: Partial<DebtSettings>) {
  settings.value = { ...settings.value, ...patch }
  if (isMock.value) return
  try {
    await $fetch('/api/debt/settings', { method: 'PUT', body: patch })
  } catch { /* keep local value; next load re-syncs */ }
}

function onPoolInput (field: 'snowball' | 'extra', event: Event) {
  const value = Number.parseFloat((event.target as HTMLInputElement).value.replace(/[$,]/g, ''))
  saveSettings({ [field]: Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : 0 })
}

function onOrderChange (event: Event) {
  const value = (event.target as HTMLSelectElement).value
  saveSettings({ order: value === 'rate' ? 'rate' : 'balance' })
}

watch(extras, (value) => {
  if (!import.meta.client) return
  try {
    localStorage.setItem(EXTRAS_KEY, JSON.stringify(value))
  } catch { /* storage blocked */ }
}, { deep: true })

function togglePlan (id: string) {
  const current = selectedPlanIds.value
  selectedPlanIds.value = current.includes(id)
    ? current.filter(item => item !== id)
    : [...current, id]
  try {
    localStorage.setItem(SYNC_PLANS_KEY, JSON.stringify(selectedPlanIds.value))
  } catch { /* storage blocked */ }
}

async function syncNow () {
  if (syncing.value || !selectedPlanIds.value.length) return
  syncing.value = true
  syncMessage.value = ''
  try {
    const result = await $fetch<{ created: number, updated: number, live_error: boolean }>('/api/debt/sync', {
      method: 'POST',
      body: { planIds: selectedPlanIds.value }
    })
    syncMessage.value = `${result.created} new · ${result.updated} refreshed${result.live_error ? ' · YNAB unreachable (token?)' : ''}`
    await loadDebts()
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    syncMessage.value = err.data?.statusMessage ?? 'Sync failed — try again.'
  } finally {
    syncing.value = false
  }
}

async function addDebt () {
  if (adding.value) return
  adding.value = true
  addMessage.value = ''
  try {
    await $fetch('/api/debt', {
      method: 'POST',
      body: {
        name: addForm.value.name,
        original: Number.parseFloat(addForm.value.original.replace(/[$,]/g, '')),
        balance: Number.parseFloat(addForm.value.balance.replace(/[$,]/g, '') || '0'),
        startMonth: addForm.value.startMonth,
        endMonth: addForm.value.endMonth || undefined,
        rate: addForm.value.rate ? Number.parseFloat(addForm.value.rate) : undefined,
        payment: addForm.value.payment ? Number.parseFloat(addForm.value.payment.replace(/[$,]/g, '')) : undefined
      }
    })
    addForm.value = { name: '', original: '', balance: '0', startMonth: '', endMonth: '', rate: '', payment: '' }
    await loadDebts()
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    addMessage.value = err.data?.statusMessage ?? 'Could not add that debt.'
  } finally {
    adding.value = false
  }
}

async function patchRow (row: DebtRecord, patch: Record<string, unknown>) {
  // `loans` rows are computed copies — mutate the source record for reactivity.
  const target = debts.value.find(item => item.id === row.id)
  if (target) Object.assign(target, patch)
  try {
    await $fetch(`/api/debt/${row.id}`, { method: 'PATCH', body: patch })
  } catch { await loadDebts() }
}

async function removeRow (row: DebtRecord) {
  await $fetch(`/api/debt/${row.id}`, { method: 'DELETE' })
  delete extras.value[row.id]
  await loadDebts()
}

// ---- Derived rows ---------------------------------------------------------

const loans = computed<LoanRow[]>(() =>
  debts.value.map((record, index) => ({
    ...record,
    color: index < PALETTE.length
      ? PALETTE[index]!
      : OVERFLOW_COLORS[(index - PALETTE.length) % OVERFLOW_COLORS.length]!
  }))
)

const visibleLoans = computed(() => loans.value.filter(loan => !loan.hidden && loan.history.length > 0))
const activeLoans = computed(() => visibleLoans.value.filter(loan => loan.balance < 0))
const trophies = computed(() => visibleLoans.value.filter(loan => loan.balance >= 0))

function derivedPayment (loan: LoanRow): number {
  if (loan.minimumPayment && loan.minimumPayment > 0) return loan.minimumPayment
  const deltas: number[] = []
  for (let i = loan.history.length - 1; i > 0 && deltas.length < 4; i--) {
    const delta = loan.history[i]!.balance - loan.history[i - 1]!.balance
    if (delta > 0) deltas.push(delta)
  }
  if (deltas.length) return Math.round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length)
  return Math.max(Math.round(-loan.balance * 0.02), 50_000)
}

const paymentFor = (loan: LoanRow) => derivedPayment(loan)
const rateFor = (loan: LoanRow) => loan.rate ?? 0

const todayMonth = computed(() => {
  let latest = ''
  for (const loan of visibleLoans.value) {
    const last = loan.history[loan.history.length - 1]?.month ?? ''
    if (last > latest) latest = last
  }
  return latest
})

const snowballActive = computed(() => settings.value.strategy === 'snowball')
const snowballPool = computed(() => settings.value.snowball + settings.value.extra)

const projections = computed(() => {
  const start = todayMonth.value ? nextDebtMonth(todayMonth.value) : ''
  const map = new Map<string, PayoffProjection>()
  if (!start) return map

  if (snowballActive.value) {
    const result = projectSnowball({
      loans: activeLoans.value.map(loan => ({
        id: loan.id,
        balance: -loan.balance,
        annualRatePct: rateFor(loan),
        minimum: paymentFor(loan),
        extraFirstMonth: extras.value[loan.id]
      })),
      pool: snowballPool.value,
      order: settings.value.order,
      fromMonth: start
    })
    for (const [id, projection] of Object.entries(result.perLoan)) map.set(id, projection)
    return map
  }

  for (const loan of activeLoans.value) {
    const extra = extras.value[loan.id]
    map.set(loan.id, projectPayoff({
      balance: -loan.balance,
      annualRatePct: rateFor(loan),
      payment: paymentFor(loan),
      fromMonth: start,
      extra: extra ? { month: start, amount: extra } : undefined
    }))
  }
  return map
})

// ---- Chart model ----------------------------------------------------------

const CHART = { width: 920, height: 330, top: 14, right: 14, bottom: 30, left: 58 }
const MAX_FUTURE_MONTHS = 121

interface ChartModel {
  months: string[]
  todayIdx: number
  bands: Array<{ loan: LoanRow, past: string, future: string }>
  values: number[][]
  trackLine: string
  todayPoint: { x: number, y: number } | null
  yTicks: Array<{ y: number, label: string }>
  xTicks: Array<{ x: number, label: string }>
  totals: number[]
}

function monthDiff (a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by! - ay!) * 12 + (bm! - am!)
}

const chart = computed<ChartModel | null>(() => {
  const rows = visibleLoans.value
  if (!rows.length || !todayMonth.value) return null

  let firstMonth = todayMonth.value
  for (const loan of rows) {
    const start = loan.history[0]?.month ?? todayMonth.value
    if (start < firstMonth) firstMonth = start
  }

  let lastMonth = nextDebtMonth(todayMonth.value)
  for (const loan of rows) {
    const projection = projections.value.get(loan.id)
    const payoff = projection?.payoffMonth ?? projection?.months[projection.months.length - 1]
    if (payoff && payoff > lastMonth) lastMonth = payoff
  }
  if (monthDiff(todayMonth.value, lastMonth) > MAX_FUTURE_MONTHS) {
    lastMonth = todayMonth.value
    for (let i = 0; i < MAX_FUTURE_MONTHS; i++) lastMonth = nextDebtMonth(lastMonth)
  }

  const months: string[] = []
  for (let key = firstMonth; key <= lastMonth; key = nextDebtMonth(key)) {
    months.push(key)
    if (months.length > 800) break
  }
  const todayIdx = months.indexOf(todayMonth.value)

  const values = rows.map((loan) => {
    const byMonth = new Map(loan.history.map(item => [item.month, item.balance]))
    const projection = projections.value.get(loan.id)
    const projByMonth = new Map((projection?.months ?? []).map((month, i) => [month, projection!.balances[i]!]))
    let carried = 0
    let started = false
    return months.map((month, index) => {
      if (index <= todayIdx) {
        if (byMonth.has(month)) { carried = byMonth.get(month)!; started = true }
        return started ? Math.max(-carried, 0) : 0
      }
      if (projByMonth.has(month)) return Math.max(projByMonth.get(month)!, 0)
      if (projection && !projection.payoffMonth && projection.months.length === 0) return Math.max(-loan.balance, 0)
      return 0
    })
  })

  const totals = months.map((_, index) => values.reduce((sum, series) => sum + series[index]!, 0))
  // Round the axis to a clean tick step ($15k/$30k/… rather than $14.3k/…)
  const rawStep = Math.max(...totals, 1) / 4
  const exp = 10 ** Math.floor(Math.log10(rawStep))
  const fraction = rawStep / exp
  const niceFraction = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find(step => fraction <= step) ?? 10
  const yMax = niceFraction * exp * 4

  const plotWidth = CHART.width - CHART.left - CHART.right
  const plotHeight = CHART.height - CHART.top - CHART.bottom
  const x = (index: number) => CHART.left + (months.length === 1 ? 0 : (index / (months.length - 1)) * plotWidth)
  const y = (value: number) => CHART.top + plotHeight - (value / yMax) * plotHeight

  const cumulative: number[][] = []
  let running = months.map(() => 0)
  for (const series of values) {
    running = running.map((value, index) => value + series[index]!)
    cumulative.push([...running])
  }

  const bandPath = (loanIdx: number, from: number, to: number): string => {
    if (to <= from) return ''
    const top = cumulative[loanIdx]!
    const bottom = loanIdx === 0 ? null : cumulative[loanIdx - 1]!
    const up: string[] = []
    const down: string[] = []
    for (let i = from; i <= to; i++) {
      up.push(`${x(i).toFixed(1)},${y(top[i]!).toFixed(1)}`)
      down.push(`${x(i).toFixed(1)},${y(bottom ? bottom[i]! : 0).toFixed(1)}`)
    }
    return `M${up.join('L')}L${down.reverse().join('L')}Z`
  }

  const bands = rows.map((loan, index) => ({
    loan,
    past: bandPath(index, 0, todayIdx),
    future: bandPath(index, todayIdx, months.length - 1)
  }))

  const trackPoints: string[] = []
  for (let i = todayIdx; i < months.length; i++) {
    trackPoints.push(`${x(i).toFixed(1)},${y(totals[i]!).toFixed(1)}`)
  }

  const yTicks = [0.25, 0.5, 0.75, 1].map(f => ({ y: y(yMax * f), label: fmtShort(yMax * f) }))
  const step = Math.max(1, Math.round(months.length / 8))
  const xTicks: ChartModel['xTicks'] = []
  for (let i = 0; i < months.length; i += step) {
    xTicks.push({ x: x(i), label: shortMonth(months[i]!) })
  }

  return {
    months,
    todayIdx,
    bands,
    values,
    trackLine: trackPoints.length > 1 ? `M${trackPoints.join('L')}` : '',
    todayPoint: todayIdx >= 0 ? { x: x(todayIdx), y: y(totals[todayIdx]!) } : null,
    yTicks,
    xTicks,
    totals
  }
})

function chartValueAt (loanId: string, index: number): number {
  const model = chart.value
  if (!model) return 0
  const bandIdx = model.bands.findIndex(band => band.loan.id === loanId)
  return bandIdx >= 0 ? model.values[bandIdx]![index] ?? 0 : 0
}

// ---- Hover ----------------------------------------------------------------

const hoverIdx = ref<number | null>(null)

function onChartMove (event: MouseEvent) {
  const model = chart.value
  if (!model) return
  const svg = event.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const px = ((event.clientX - rect.left) / rect.width) * CHART.width
  const plotWidth = CHART.width - CHART.left - CHART.right
  const fraction = Math.min(Math.max((px - CHART.left) / plotWidth, 0), 1)
  hoverIdx.value = Math.round(fraction * (model.months.length - 1))
}

const hover = computed(() => {
  const model = chart.value
  if (!model || hoverIdx.value === null) return null
  const index = hoverIdx.value
  const plotWidth = CHART.width - CHART.left - CHART.right
  const x = CHART.left + (index / (model.months.length - 1)) * plotWidth
  return {
    x,
    month: model.months[index]!,
    phase: index <= model.todayIdx ? 'actual' : 'projected',
    total: model.totals[index]!,
    alignRight: x > CHART.width * 0.62
  }
})

// ---- Totals & formatting --------------------------------------------------

const totalBalance = computed(() => activeLoans.value.reduce((sum, loan) => sum - loan.balance, 0))
const totalPaidIn = computed(() => visibleLoans.value.reduce((sum, loan) => sum + loan.paidIn, 0))
const totalMinimums = computed(() => activeLoans.value.reduce((sum, loan) => sum + paymentFor(loan), 0))
const totalPayment = computed(() =>
  snowballActive.value ? totalMinimums.value + snowballPool.value : totalMinimums.value
)
const totalInterest = computed(() =>
  activeLoans.value.reduce((sum, loan) => sum + (projections.value.get(loan.id)?.interestTotal ?? 0), 0)
)
const stuckLoans = computed(() =>
  activeLoans.value.filter(loan => !projections.value.get(loan.id)?.payoffMonth)
)
const debtFreeMonth = computed(() => {
  if (!activeLoans.value.length) return null
  let latest: string | null = ''
  for (const loan of activeLoans.value) {
    const payoff = projections.value.get(loan.id)?.payoffMonth
    if (!payoff) { latest = null; break }
    if (payoff > latest!) latest = payoff
  }
  return latest || null
})

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const fmt = (milliunits: number) => usd.format(milliunits / 1000)
const fmtShort = (milliunits: number) => {
  const dollars = milliunits / 1000
  return dollars >= 1000 ? `$${Math.round(dollars / 1000)}k` : `$${Math.round(dollars)}`
}
const monthLabel = (key: string) =>
  new Date(`${key}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const shortMonth = (key: string) => {
  const date = new Date(`${key}T00:00:00`)
  return `${date.toLocaleDateString('en-US', { month: 'short' })} '${String(date.getFullYear()).slice(2)}`
}
const dateLabel = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

const timeUntil = (payoff: string) => {
  const total = monthDiff(todayMonth.value, payoff)
  const years = Math.floor(total / 12)
  const rem = total % 12
  if (years && rem) return `${years} yr, ${rem} mo`
  if (years) return `${years} yr`
  return `${rem} mo`
}

const syncedLabel = computed(() => {
  if (!lastSynced.value) return ''
  return new Date(lastSynced.value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
})

// ---- Row edit handlers ----------------------------------------------------

function onRate (loan: LoanRow, event: Event) {
  const value = Number.parseFloat((event.target as HTMLInputElement).value)
  patchRow(loan, { rate: Number.isFinite(value) && value > 0 ? value : null })
}

function onPayment (loan: LoanRow, event: Event) {
  const value = Number.parseFloat((event.target as HTMLInputElement).value.replace(/[$,]/g, ''))
  patchRow(loan, { minimumPayment: Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : null })
}

function onExtra (loan: LoanRow, event: Event) {
  const value = Number.parseFloat((event.target as HTMLInputElement).value.replace(/[$,]/g, ''))
  if (Number.isFinite(value) && value > 0) extras.value[loan.id] = Math.round(value * 1000)
  else delete extras.value[loan.id]
}
</script>

<template>
  <main class="page">
    <header class="top">
      <div>
        <h1><NuxtLink to="/">YNABRR</NuxtLink> <span class="crumb">/ Debt</span></h1>
        <p class="tagline">
          Every loan's real history — synced from YNAB or added by hand — then
          the road ahead. Tweak payments and rates to bend the curve.
        </p>
      </div>
      <nav class="nav">
        <NuxtLink to="/sandbox">Sandbox</NuxtLink>
        <span v-if="isMock" class="badge">Mock data</span>
        <NuxtLink v-if="authUser" to="/account">{{ authUser.email }}</NuxtLink>
        <NuxtLink v-else-if="!isMock" to="/login">Sign in</NuxtLink>
      </nav>
    </header>

    <section v-if="!isMock && !loading" class="sync-bar">
      <span class="picker-label">Sync from</span>
      <template v-if="syncPlans.length">
        <label v-for="plan in syncPlans" :key="plan.id" class="pill" :class="{ on: selectedPlanIds.includes(plan.id) }">
          <input type="checkbox" :checked="selectedPlanIds.includes(plan.id)" @change="togglePlan(plan.id)">
          {{ plan.name }}
        </label>
        <button class="primary" :disabled="syncing || !selectedPlanIds.length" @click="syncNow">
          {{ syncing ? 'Syncing…' : 'Sync now' }}
        </button>
      </template>
      <span v-else class="muted">
        No budgets available — save a YNAB token or import a zip on
        <NuxtLink to="/account">your account</NuxtLink>.
      </span>
      <span v-if="syncMessage" class="sync-msg">{{ syncMessage }}</span>
      <span v-else-if="syncedLabel" class="muted">last synced {{ syncedLabel }}</span>
    </section>

    <p v-if="loading" class="status">Loading debt history…</p>

    <section v-else-if="!loans.length" class="status">
      <h2>No debts tracked yet</h2>
      <p v-if="!authUser && !isMock && !syncPlans.length">
        <NuxtLink to="/login">Sign in</NuxtLink>, connect a token or import an export
        zip, then hit <em>Sync now</em> — or add debts by hand below.
      </p>
      <p v-else>
        Hit <em>Sync now</em> above to pull loans from your budgets, or add one by
        hand below — paid-off debts welcome too.
      </p>
    </section>

    <template v-else>
      <section class="stats">
        <article>
          <h3>Total debt</h3>
          <p>{{ fmt(totalBalance) }}</p>
          <p class="sub">across {{ activeLoans.length }} active {{ activeLoans.length === 1 ? 'loan' : 'loans' }}</p>
        </article>
        <article>
          <h3>Paid down</h3>
          <p>{{ fmt(totalPaidIn) }}</p>
          <p class="sub">
            including {{ trophies.length }} paid-off {{ trophies.length === 1 ? 'debt' : 'debts' }}
          </p>
        </article>
        <article>
          <h3>Monthly payments</h3>
          <p>{{ fmt(totalPayment) }}</p>
          <p class="sub">
            <template v-if="snowballActive">{{ fmt(totalMinimums) }} minimums + {{ fmt(snowballPool) }} snowball</template>
            <template v-else>current plan, editable below</template>
          </p>
        </article>
        <article :class="{ negative: activeLoans.length && !debtFreeMonth }">
          <h3>Debt-free</h3>
          <p>{{ debtFreeMonth ? monthLabel(debtFreeMonth) : (activeLoans.length ? '—' : '🎉 already') }}</p>
          <p class="sub">
            <template v-if="debtFreeMonth">{{ timeUntil(debtFreeMonth) }} away · ~{{ fmt(totalInterest) }} interest to go</template>
            <template v-else-if="activeLoans.length">some loans never amortize at these payments</template>
            <template v-else>nothing active — just trophies</template>
          </p>
        </article>
      </section>

      <section class="strategy-bar">
        <span class="picker-label">Payoff strategy</span>
        <div class="mode-pills">
          <button :class="{ on: !snowballActive }" @click="saveSettings({ strategy: 'separate' })">Separate</button>
          <button :class="{ on: snowballActive }" @click="saveSettings({ strategy: 'snowball' })">Snowball</button>
        </div>
        <template v-if="snowballActive">
          <label class="pool-field">
            Snowball
            <input
              type="text" inputmode="decimal"
              :value="settings.snowball ? (settings.snowball / 1000).toFixed(2) : ''"
              placeholder="0" aria-label="Monthly snowball amount"
              title="Committed monthly amount on top of minimums — rolls to the next debt as each is paid off"
              @change="onPoolInput('snowball', $event)"
            >
            /mo
          </label>
          <label class="pool-field">
            Extra
            <input
              type="text" inputmode="decimal"
              :value="settings.extra ? (settings.extra / 1000).toFixed(2) : ''"
              placeholder="0" aria-label="Extra monthly what-if amount"
              title="What-if: how much sooner with this much more per month?"
              @change="onPoolInput('extra', $event)"
            >
            /mo
          </label>
          <select :value="settings.order" aria-label="Snowball target order" @change="onOrderChange">
            <option value="balance">Smallest balance first</option>
            <option value="rate">Highest APR first</option>
          </select>
        </template>
        <span v-else class="muted">each loan pays its own monthly, independently</span>
      </section>

      <section v-if="chart" class="chart-card">
        <svg
          :viewBox="`0 0 ${CHART.width} ${CHART.height}`"
          class="burndown"
          role="img"
          aria-label="Stacked debt balance history and projected payoff"
          @mousemove="onChartMove"
          @mouseleave="hoverIdx = null"
        >
          <line v-for="tick in chart.yTicks" :key="`y${tick.y}`" :x1="CHART.left" :x2="CHART.width - CHART.right" :y1="tick.y" :y2="tick.y" class="grid" />
          <text v-for="tick in chart.yTicks" :key="`yl${tick.y}`" :x="CHART.left - 8" :y="tick.y + 4" class="tick" text-anchor="end">{{ tick.label }}</text>
          <text v-for="tick in chart.xTicks" :key="`x${tick.x}`" :x="tick.x" :y="CHART.height - 8" class="tick" text-anchor="middle">{{ tick.label }}</text>

          <g>
            <path v-for="band in chart.bands" :key="`p${band.loan.id}`" :d="band.past" :fill="band.loan.color" class="band past" />
            <path v-for="band in chart.bands" :key="`f${band.loan.id}`" :d="band.future" :fill="band.loan.color" class="band future" />
          </g>

          <path v-if="chart.trackLine" :d="chart.trackLine" class="track" />
          <line v-if="chart.todayPoint" :x1="chart.todayPoint.x" :x2="chart.todayPoint.x" :y1="CHART.top" :y2="CHART.height - CHART.bottom" class="today-line" />
          <circle v-if="chart.todayPoint" :cx="chart.todayPoint.x" :cy="chart.todayPoint.y" r="5" class="today-dot" />
          <line v-if="hover" :x1="hover.x" :x2="hover.x" :y1="CHART.top" :y2="CHART.height - CHART.bottom" class="crosshair" />
        </svg>

        <div
          v-if="hover && hoverIdx !== null"
          class="tooltip"
          :style="{ left: `${(hover.x / CHART.width) * 100}%`, transform: hover.alignRight ? 'translateX(-100%)' : 'none' }"
        >
          <p class="tip-title">{{ monthLabel(hover.month) }} <span class="tip-phase">{{ hover.phase }}</span></p>
          <p v-for="band in chart!.bands" :key="band.loan.id" class="tip-row">
            <span class="chip" :style="{ background: band.loan.color }" />
            <span class="tip-name">{{ band.loan.name }}</span>
            <span class="tip-value">{{ fmt(chartValueAt(band.loan.id, hoverIdx)) }}</span>
          </p>
          <p class="tip-row tip-total">
            <span class="tip-name">Total</span>
            <span class="tip-value">{{ fmt(hover.total) }}</span>
          </p>
        </div>

        <div class="legend">
          <span v-for="loan in visibleLoans" :key="loan.id" class="legend-item">
            <span class="chip" :style="{ background: loan.color }" />
            {{ loan.name }}<template v-if="loan.balance >= 0"> ✓</template>
          </span>
          <span class="legend-item muted"><span class="chip solid" /> actual</span>
          <span class="legend-item muted"><span class="chip dashed" /> projected</span>
        </div>

        <p v-if="debtFreeMonth && snowballActive" class="payoff-strip">
          Snowballing <strong>{{ fmt(snowballPool) }}</strong> on top of {{ fmt(totalMinimums) }} in minimums
          clears everything by <strong>{{ monthLabel(debtFreeMonth) }}</strong> —
          {{ timeUntil(debtFreeMonth) }} from now. As each loan falls, its payment rolls into the next.
        </p>
        <p v-else-if="debtFreeMonth" class="payoff-strip">
          Paying <strong>{{ fmt(totalPayment) }}</strong> a month clears everything by
          <strong>{{ monthLabel(debtFreeMonth) }}</strong> — {{ timeUntil(debtFreeMonth) }} from now.
        </p>
        <p v-else-if="stuckLoans.length" class="payoff-strip warn">
          {{ stuckLoans.map(loan => loan.name).join(', ') }}
          {{ stuckLoans.length === 1 ? "doesn't" : "don't" }} amortize at the current
          payment — raise the monthly amount below.
        </p>
      </section>

      <section class="table-wrap">
        <table>
          <thead>
            <tr>
              <th />
              <th class="name">Debt</th>
              <th>Started</th>
              <th class="num">Original</th>
              <th class="num">Paid in</th>
              <th class="num">Balance</th>
              <th class="num edit">APR %</th>
              <th class="num edit">Monthly</th>
              <th class="num edit">Extra next mo</th>
              <th>Payoff</th>
              <th class="num">Interest left</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="loan in loans" :key="loan.id" :class="{ off: loan.hidden }">
              <td>
                <input type="checkbox" :checked="!loan.hidden" :aria-label="`Include ${loan.name}`" @change="patchRow(loan, { hidden: !loan.hidden })">
              </td>
              <td class="name">
                <span class="chip" :style="{ background: loan.color }" />
                {{ loan.name }}
                <span class="plan-name">{{ loan.source === 'manual' ? 'manual' : loan.planName }}</span>
              </td>
              <td>{{ loan.startDate ? dateLabel(loan.startDate) : '—' }}</td>
              <td class="num">{{ fmt(-loan.startBalance) }}</td>
              <td class="num">{{ fmt(loan.paidIn) }}</td>
              <td class="num strong">{{ loan.balance < 0 ? fmt(-loan.balance) : 'Paid ✓' }}</td>
              <td class="num edit">
                <input type="text" inputmode="decimal" :value="loan.rate ?? ''" placeholder="0" :aria-label="`APR for ${loan.name}`" :disabled="loan.hidden || loan.balance >= 0" @change="onRate(loan, $event)">
              </td>
              <td class="num edit">
                <input type="text" inputmode="decimal" :value="loan.balance < 0 ? (paymentFor(loan) / 1000).toFixed(2) : ''" :aria-label="`Monthly payment for ${loan.name}`" :disabled="loan.hidden || loan.balance >= 0" @change="onPayment(loan, $event)">
              </td>
              <td class="num edit">
                <input type="text" inputmode="decimal" :value="extras[loan.id] ? (extras[loan.id]! / 1000).toFixed(2) : ''" placeholder="0" :aria-label="`One-time extra payment for ${loan.name}`" :disabled="loan.hidden || loan.balance >= 0" @change="onExtra(loan, $event)">
              </td>
              <td>
                <template v-if="loan.balance >= 0">{{ loan.endDate ? dateLabel(loan.endDate) : 'Paid' }} 🏆</template>
                <template v-else-if="loan.hidden">—</template>
                <template v-else-if="projections.get(loan.id)?.payoffMonth">{{ dateLabel(projections.get(loan.id)!.payoffMonth!) }}</template>
                <template v-else>never at this rate</template>
              </td>
              <td class="num">
                {{ loan.balance < 0 && !loan.hidden && projections.get(loan.id)?.payoffMonth ? fmt(projections.get(loan.id)!.interestTotal) : '—' }}
              </td>
              <td>
                <button v-if="loan.source === 'manual' && !isMock" class="reset" title="Delete this debt" @click="removeRow(loan)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

    </template>

    <section v-if="!loading && !isMock" class="manage">
      <h2>Add a debt by hand</h2>
      <p class="muted">
        Anything YNAB never saw — old loans included. Fully paid-off debts show
        on the chart as history, so the mountain remembers what you've conquered.
      </p>
      <form class="add-form" @submit.prevent="addDebt">
        <input v-model="addForm.name" placeholder="Name (🎓 Old Student Loans)" aria-label="Debt name" required>
        <input v-model="addForm.original" placeholder="Original $" aria-label="Original amount" inputmode="decimal" required>
        <input v-model="addForm.balance" placeholder="Balance now $ (0 = paid)" aria-label="Current balance" inputmode="decimal">
        <input v-model="addForm.startMonth" type="month" aria-label="Started" required>
        <input v-model="addForm.endMonth" type="month" aria-label="Paid off (optional)">
        <input v-model="addForm.rate" placeholder="APR %" aria-label="APR" inputmode="decimal">
        <input v-model="addForm.payment" placeholder="Monthly $" aria-label="Monthly payment" inputmode="decimal">
        <button class="primary" type="submit" :disabled="adding">{{ adding ? 'Adding…' : 'Add debt' }}</button>
      </form>
      <p v-if="addMessage" class="muted">{{ addMessage }}</p>
    </section>

    <p v-if="!loading && loans.length" class="footnote">
      Synced rows refresh from YNAB when you hit Sync (your APR and Monthly
      edits survive). Manual rows chart a straight paydown between their two
      known points. "Extra next mo" is a what-if that stays in this browser.
    </p>
  </main>
</template>

<style scoped>
.page {
  max-width: 60rem;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 5rem;
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
.tagline { margin: 0.25rem 0 0; color: #666; max-width: 36rem; }

.nav { display: flex; gap: 0.9rem; align-items: center; }
.nav a { color: #4a7dff; text-decoration: none; font-size: 0.9rem; }
.nav a:hover { text-decoration: underline; }

.badge {
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: #fff3cd;
  border: 1px solid #ffe08a;
  color: #7a5d00;
  font-size: 0.8rem;
}

.sync-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-top: 1.1rem;
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
  padding: 0.28rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 999px;
  background: #fff;
  font-size: 0.85rem;
  cursor: pointer;
  user-select: none;
}

.pill input { position: absolute; opacity: 0; pointer-events: none; }
.pill.on { border-color: #4a7dff; background: #eef4ff; color: #2b52c7; }

.primary {
  padding: 0.35rem 0.9rem;
  border: 1px solid #4a7dff;
  border-radius: 6px;
  background: #4a7dff;
  color: #fff;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}

.primary:disabled { opacity: 0.55; cursor: not-allowed; }

.sync-msg { font-size: 0.85rem; color: #1b7f3b; }
.muted { color: #999; font-size: 0.85rem; }

.strategy-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
  margin: 0 0 1rem;
}

.mode-pills {
  display: inline-flex;
  border: 1px solid #ccc;
  border-radius: 999px;
  overflow: hidden;
}

.mode-pills button {
  padding: 0.3rem 0.9rem;
  border: none;
  background: #fff;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  color: #555;
}

.mode-pills button.on {
  background: #4a7dff;
  color: #fff;
}

.pool-field {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: #555;
}

.pool-field input {
  width: 5.5rem;
  padding: 0.3rem 0.45rem;
  border: 1px solid #b9c9f5;
  border-radius: 6px;
  font: inherit;
  font-size: 0.85rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.strategy-bar select {
  padding: 0.32rem 0.5rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  font: inherit;
  font-size: 0.85rem;
}

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

.stats article { padding: 0.9rem 1.1rem; border: 1px solid #ddd; border-radius: 8px; }

.stats h3 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #777;
}

.stats p { margin: 0.25rem 0 0; font-size: 1.35rem; font-variant-numeric: tabular-nums; }
.stats .sub { font-size: 0.8rem; color: #999; }
.stats .negative p { color: #b3261e; }

.chart-card {
  position: relative;
  padding: 1rem 1.1rem 0.9rem;
  border: 1px solid #ddd;
  border-radius: 8px;
  margin-bottom: 1.5rem;
}

.burndown { width: 100%; height: auto; display: block; }

.grid { stroke: #eee; stroke-width: 1; }
.tick { fill: #999; font-size: 11px; font-variant-numeric: tabular-nums; }

.band.past { opacity: 0.85; stroke: #fff; stroke-width: 2; }
.band.future { opacity: 0.28; stroke: #fff; stroke-width: 2; }

.track { fill: none; stroke: #4a7dff; stroke-width: 2; stroke-dasharray: 6 5; }
.today-line { stroke: #c9d4f2; stroke-width: 1; stroke-dasharray: 2 3; }
.today-dot { fill: #fff; stroke: #4a7dff; stroke-width: 2.5; }
.crosshair { stroke: #b6b6b6; stroke-width: 1; }

.tooltip {
  position: absolute;
  top: 1.2rem;
  padding: 0.5rem 0.7rem;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 10%);
  font-size: 0.8rem;
  pointer-events: none;
  min-width: 13rem;
  z-index: 5;
}

.tip-title { margin: 0 0 0.3rem; font-weight: 600; }
.tip-phase { color: #999; font-weight: 400; font-style: italic; margin-left: 0.3rem; }
.tip-row { margin: 0.1rem 0; display: flex; align-items: center; gap: 0.4rem; }
.tip-name { flex: 1; color: #444; }
.tip-value { font-variant-numeric: tabular-nums; }
.tip-total { border-top: 1px solid #eee; margin-top: 0.3rem; padding-top: 0.3rem; font-weight: 600; }

.chip { display: inline-block; width: 10px; height: 10px; border-radius: 3px; flex: none; }

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.1rem;
  margin: 0.6rem 0 0.2rem;
  font-size: 0.82rem;
  color: #444;
}

.legend-item { display: inline-flex; align-items: center; gap: 0.4rem; }
.legend-item.muted { color: #999; }
.chip.solid { background: #b9c4dd; }
.chip.dashed { background: transparent; border: 2px dashed #4a7dff; width: 12px; height: 6px; border-radius: 2px; }

.payoff-strip {
  margin: 0.8rem 0 0.2rem;
  padding: 0.6rem 0.9rem;
  background: #eef2ff;
  border-radius: 6px;
  font-size: 0.9rem;
}

.payoff-strip.warn { background: #fff8e1; }

.table-wrap { overflow-x: auto; }

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  min-width: 60rem;
}

thead th {
  text-align: left;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #888;
  border-bottom: 2px solid #ddd;
  padding: 0.45rem 0.55rem;
}

td { padding: 0.45rem 0.55rem; border-bottom: 1px solid #eee; }

th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.strong { font-weight: 600; }
td.name { white-space: nowrap; }
td.name .chip { margin-right: 0.4rem; }

.plan-name { margin-left: 0.45rem; font-size: 0.72rem; color: #999; }

th.edit, td.edit { background: #f7faff; }
td.edit input {
  width: 6rem;
  padding: 0.25rem 0.4rem;
  border: 1px solid #b9c9f5;
  border-radius: 6px;
  font: inherit;
  font-size: 0.85rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

td.edit input:disabled { background: #f3f5f9; border-color: #dde3f0; color: #a9b0bf; }

tr.off td { color: #a9b0bf; }

.reset { border: none; background: none; cursor: pointer; color: #4a7dff; font-size: 1rem; }

.manage {
  margin-top: 1.6rem;
  padding: 1rem 1.25rem;
  border: 1px solid #ddd;
  border-radius: 8px;
}

.manage h2 { margin: 0 0 0.3rem; font-size: 1.05rem; }

.add-form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.7rem;
}

.add-form input {
  padding: 0.4rem 0.55rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  font: inherit;
  font-size: 0.875rem;
}

.add-form input:first-child { flex: 1 1 14rem; }

.footnote { color: #999; font-size: 0.8rem; margin-top: 1rem; }
</style>
