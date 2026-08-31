<script setup lang="ts">
const { user: authUser, refresh: refreshAuth } = useAuth()

// Fixed categorical order (validated against the app surface); color follows
// the loan, never its rank or the current selection.
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']

interface SourceAccount {
  name: string
  startDate: string
  startBalance: number
  balance: number
  paidIn: number
  history: Array<{ month: string, balance: number }>
  rate?: number
  minimumPayment?: number
}

interface LoanRow extends SourceAccount {
  key: string
  planName: string
  color: string
}

interface Tweak {
  off?: boolean
  rate?: number
  payment?: number
  extra?: number
}

const TWEAKS_KEY = 'ynabrr:debt:tweaks'

const loans = ref<LoanRow[]>([])
const sourceCount = ref(0)
const accountCount = ref(0)
const isMock = ref(false)
const loading = ref(true)
const liveError = ref(false)
const tweaks = ref<Record<string, Tweak>>({})

onMounted(async () => {
  try {
    tweaks.value = JSON.parse(localStorage.getItem(TWEAKS_KEY) ?? '{}')
  } catch { /* fresh start */ }

  try {
    await refreshAuth()
    const status = await $fetch<{ mock: boolean }>('/api/ynab/status')
    isMock.value = status.mock
    const data = await $fetch<{ sources: Array<{ planId: string, planName: string, accounts: SourceAccount[] }>, live_error?: boolean }>('/api/ynab/debt')
    liveError.value = Boolean(data.live_error)
    sourceCount.value = data.sources.length
    accountCount.value = data.sources.reduce((sum, source) => sum + source.accounts.length, 0)
    loans.value = data.sources
      .flatMap(source => source.accounts
        .filter(account => account.balance < 0 && account.history.length > 0)
        .map(account => ({ ...account, key: `${source.planId}:${account.name}`, planName: source.planName, color: '' })))
      .sort((a, b) => a.balance - b.balance)
      .map((loan, index) => ({ ...loan, color: PALETTE[index % PALETTE.length]! }))
  } catch { /* empty state below */ }
  loading.value = false
})

watch(tweaks, (value) => {
  if (!import.meta.client) return
  try {
    localStorage.setItem(TWEAKS_KEY, JSON.stringify(value))
  } catch { /* storage blocked */ }
}, { deep: true })

const tweakFor = (loan: LoanRow): Tweak => tweaks.value[loan.key] ?? {}
const isOff = (loan: LoanRow) => Boolean(tweakFor(loan).off)
const activeLoans = computed(() => loans.value.filter(loan => !isOff(loan)))

// Default payment: the account's real minimum payment when the live API
// provides it, else average principal progress over recent history (which
// underestimates by the interest share — the APR input closes it).
function defaultPayment (loan: LoanRow): number {
  if (loan.minimumPayment && loan.minimumPayment > 0) return loan.minimumPayment
  const deltas: number[] = []
  for (let i = loan.history.length - 1; i > 0 && deltas.length < 4; i--) {
    const delta = loan.history[i]!.balance - loan.history[i - 1]!.balance
    if (delta > 0) deltas.push(delta)
  }
  if (deltas.length) return Math.round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length)
  return Math.max(Math.round(-loan.balance * 0.02), 50_000)
}

const paymentFor = (loan: LoanRow) => tweakFor(loan).payment ?? defaultPayment(loan)
const rateFor = (loan: LoanRow) => tweakFor(loan).rate ?? loan.rate ?? 0

const todayMonth = computed(() => {
  let latest = ''
  for (const loan of loans.value) {
    const last = loan.history[loan.history.length - 1]?.month ?? ''
    if (last > latest) latest = last
  }
  return latest
})

const projections = computed(() => {
  const start = todayMonth.value ? nextDebtMonth(todayMonth.value) : ''
  const map = new Map<string, PayoffProjection>()
  if (!start) return map
  for (const loan of activeLoans.value) {
    const extra = tweakFor(loan).extra
    map.set(loan.key, projectPayoff({
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
  const active = activeLoans.value
  if (!active.length || !todayMonth.value) return null

  let firstMonth = todayMonth.value
  for (const loan of active) {
    const start = loan.history[0]?.month ?? todayMonth.value
    if (start < firstMonth) firstMonth = start
  }

  let lastMonth = nextDebtMonth(todayMonth.value)
  for (const loan of active) {
    const projection = projections.value.get(loan.key)
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

  // Per-loan magnitude per month: history with carry-forward, then projection.
  const values = active.map((loan) => {
    const byMonth = new Map(loan.history.map(item => [item.month, item.balance]))
    const projection = projections.value.get(loan.key)
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

  // Stack bottom-up: cumulative sums in loan order.
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

  const bands = active.map((loan, index) => ({
    loan,
    past: bandPath(index, 0, todayIdx),
    future: bandPath(index, todayIdx, months.length - 1)
  }))

  const trackPoints: string[] = []
  for (let i = todayIdx; i < months.length; i++) {
    trackPoints.push(`${x(i).toFixed(1)},${y(totals[i]!).toFixed(1)}`)
  }

  const yTicks = [0.25, 0.5, 0.75, 1].map((fraction) => ({
    y: y(yMax * fraction),
    label: fmtShort(yMax * fraction)
  }))

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

function chartValueAt (loanKey: string, index: number): number {
  const model = chart.value
  if (!model) return 0
  const bandIdx = model.bands.findIndex(band => band.loan.key === loanKey)
  return bandIdx >= 0 ? model.values[bandIdx]![index] ?? 0 : 0
}

// ---- Hover ----------------------------------------------------------------

const hoverIdx = ref<number | null>(null)
const hoverX = ref(0)

function onChartMove (event: MouseEvent) {
  const model = chart.value
  if (!model) return
  const svg = event.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const px = ((event.clientX - rect.left) / rect.width) * CHART.width
  const plotWidth = CHART.width - CHART.left - CHART.right
  const fraction = Math.min(Math.max((px - CHART.left) / plotWidth, 0), 1)
  hoverIdx.value = Math.round(fraction * (model.months.length - 1))
  hoverX.value = CHART.left + fraction * plotWidth
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
const totalPaidIn = computed(() => activeLoans.value.reduce((sum, loan) => sum + loan.paidIn, 0))
const totalPayment = computed(() => activeLoans.value.reduce((sum, loan) => sum + paymentFor(loan), 0))
const totalInterest = computed(() =>
  activeLoans.value.reduce((sum, loan) => sum + (projections.value.get(loan.key)?.interestTotal ?? 0), 0)
)
const stuckLoans = computed(() =>
  activeLoans.value.filter(loan => !projections.value.get(loan.key)?.payoffMonth)
)
const debtFreeMonth = computed(() => {
  let latest: string | null = ''
  for (const loan of activeLoans.value) {
    const payoff = projections.value.get(loan.key)?.payoffMonth
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
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

const timeUntil = (payoff: string) => {
  const total = monthDiff(todayMonth.value, payoff)
  const years = Math.floor(total / 12)
  const rem = total % 12
  if (years && rem) return `${years} yr, ${rem} mo`
  if (years) return `${years} yr`
  return `${rem} mo`
}

// ---- Tweak handlers -------------------------------------------------------

function updateTweak (loan: LoanRow, patch: Partial<Tweak>) {
  tweaks.value[loan.key] = { ...tweakFor(loan), ...patch }
}

function onRate (loan: LoanRow, event: Event) {
  const value = Number.parseFloat((event.target as HTMLInputElement).value)
  updateTweak(loan, { rate: Number.isFinite(value) && value > 0 ? value : undefined })
}

function onPayment (loan: LoanRow, event: Event) {
  const value = Number.parseFloat((event.target as HTMLInputElement).value.replace(/[$,]/g, ''))
  updateTweak(loan, { payment: Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : undefined })
}

function onExtra (loan: LoanRow, event: Event) {
  const value = Number.parseFloat((event.target as HTMLInputElement).value.replace(/[$,]/g, ''))
  updateTweak(loan, { extra: Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : undefined })
}
</script>

<template>
  <main class="page">
    <header class="top">
      <div>
        <h1><NuxtLink to="/">YNABRR</NuxtLink> <span class="crumb">/ Debt</span></h1>
        <p class="tagline">
          Every loan's real history from your YNAB exports, then the road ahead —
          tweak payments and rates to bend the curve.
        </p>
      </div>
      <nav class="nav">
        <NuxtLink to="/sandbox">Sandbox</NuxtLink>
        <span v-if="isMock" class="badge">Mock data</span>
        <NuxtLink v-if="authUser" to="/account">{{ authUser.email }}</NuxtLink>
        <NuxtLink v-else-if="!isMock" to="/login">Sign in</NuxtLink>
      </nav>
    </header>

    <p v-if="loading" class="status">Loading debt history…</p>

    <section v-else-if="!loans.length" class="status">
      <h2>No debt history yet</h2>
      <p v-if="!authUser && !isMock">
        <NuxtLink to="/login">Sign in</NuxtLink> and import a YNAB export zip — the
        register inside it carries every loan's balance history.
      </p>
      <p v-else-if="sourceCount && !accountCount">
        Your imports predate account history — re-import your export zips on the
        <NuxtLink to="/account">account page</NuxtLink> and loans will appear here.
      </p>
      <p v-else>
        Import a YNAB export zip on the <NuxtLink to="/account">account page</NuxtLink> —
        any account with a negative balance shows up here as a loan.
      </p>
    </section>

    <template v-else>
      <p v-if="liveError" class="status warn-strip">
        Couldn't reach YNAB with your saved token just now — showing imported
        history only. Live loans (with real APRs and minimum payments) will
        appear once the token works.
      </p>
      <section class="stats">
        <article>
          <h3>Total debt</h3>
          <p>{{ fmt(totalBalance) }}</p>
          <p class="sub">across {{ activeLoans.length }} {{ activeLoans.length === 1 ? 'loan' : 'loans' }}</p>
        </article>
        <article>
          <h3>Paid so far</h3>
          <p>{{ fmt(totalPaidIn) }}</p>
          <p class="sub">since tracking began</p>
        </article>
        <article>
          <h3>Monthly payments</h3>
          <p>{{ fmt(totalPayment) }}</p>
          <p class="sub">current plan, editable below</p>
        </article>
        <article :class="{ negative: !debtFreeMonth }">
          <h3>Debt-free</h3>
          <p>{{ debtFreeMonth ? monthLabel(debtFreeMonth) : '—' }}</p>
          <p class="sub">
            <template v-if="debtFreeMonth">{{ timeUntil(debtFreeMonth) }} away · ~{{ fmt(totalInterest) }} interest to go</template>
            <template v-else>some loans never amortize at these payments</template>
          </p>
        </article>
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
          <line
            v-for="tick in chart.yTicks"
            :key="`y${tick.y}`"
            :x1="CHART.left" :x2="CHART.width - CHART.right"
            :y1="tick.y" :y2="tick.y"
            class="grid"
          />
          <text
            v-for="tick in chart.yTicks"
            :key="`yl${tick.y}`"
            :x="CHART.left - 8" :y="tick.y + 4"
            class="tick" text-anchor="end"
          >{{ tick.label }}</text>
          <text
            v-for="tick in chart.xTicks"
            :key="`x${tick.x}`"
            :x="tick.x" :y="CHART.height - 8"
            class="tick" text-anchor="middle"
          >{{ tick.label }}</text>

          <g>
            <path
              v-for="band in chart.bands"
              :key="`p${band.loan.key}`"
              :d="band.past"
              :fill="band.loan.color"
              class="band past"
            />
            <path
              v-for="band in chart.bands"
              :key="`f${band.loan.key}`"
              :d="band.future"
              :fill="band.loan.color"
              class="band future"
            />
          </g>

          <path v-if="chart.trackLine" :d="chart.trackLine" class="track" />
          <line
            v-if="chart.todayPoint"
            :x1="chart.todayPoint.x" :x2="chart.todayPoint.x"
            :y1="CHART.top" :y2="CHART.height - CHART.bottom"
            class="today-line"
          />
          <circle
            v-if="chart.todayPoint"
            :cx="chart.todayPoint.x" :cy="chart.todayPoint.y" r="5"
            class="today-dot"
          />

          <line
            v-if="hover"
            :x1="hover.x" :x2="hover.x"
            :y1="CHART.top" :y2="CHART.height - CHART.bottom"
            class="crosshair"
          />
        </svg>

        <div
          v-if="hover && hoverIdx !== null"
          class="tooltip"
          :style="{ left: `${(hover.x / CHART.width) * 100}%`, transform: hover.alignRight ? 'translateX(-100%)' : 'none' }"
        >
          <p class="tip-title">{{ monthLabel(hover.month) }} <span class="tip-phase">{{ hover.phase }}</span></p>
          <p v-for="band in chart!.bands" :key="band.loan.key" class="tip-row">
            <span class="chip" :style="{ background: band.loan.color }" />
            <span class="tip-name">{{ band.loan.name }}</span>
            <span class="tip-value">{{ fmt(chartValueAt(band.loan.key, hoverIdx)) }}</span>
          </p>
          <p class="tip-row tip-total">
            <span class="tip-name">Total</span>
            <span class="tip-value">{{ fmt(hover.total) }}</span>
          </p>
        </div>

        <div class="legend">
          <span v-for="loan in activeLoans" :key="loan.key" class="legend-item">
            <span class="chip" :style="{ background: loan.color }" />
            {{ loan.name }}
          </span>
          <span class="legend-item muted"><span class="chip solid" /> actual</span>
          <span class="legend-item muted"><span class="chip dashed" /> projected</span>
        </div>

        <p v-if="debtFreeMonth" class="payoff-strip">
          Paying <strong>{{ fmt(totalPayment) }}</strong> a month clears everything by
          <strong>{{ monthLabel(debtFreeMonth) }}</strong> — {{ timeUntil(debtFreeMonth) }} from now.
        </p>
        <p v-else class="payoff-strip warn">
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
              <th class="name">Loan</th>
              <th>Started</th>
              <th class="num">Original</th>
              <th class="num">Paid in</th>
              <th class="num">Balance</th>
              <th class="num edit">APR %</th>
              <th class="num edit">Monthly</th>
              <th class="num edit">Extra next mo</th>
              <th>Payoff</th>
              <th class="num">Interest left</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="loan in loans" :key="loan.key" :class="{ off: isOff(loan) }">
              <td>
                <input
                  type="checkbox"
                  :checked="!isOff(loan)"
                  :aria-label="`Include ${loan.name}`"
                  @change="updateTweak(loan, { off: !isOff(loan) || undefined })"
                >
              </td>
              <td class="name">
                <span class="chip" :style="{ background: loan.color }" />
                {{ loan.name }}
                <span class="plan-name">{{ loan.planName }}</span>
              </td>
              <td>{{ dateLabel(loan.startDate) }}</td>
              <td class="num">{{ fmt(-loan.startBalance) }}</td>
              <td class="num">{{ fmt(loan.paidIn) }}</td>
              <td class="num strong">{{ fmt(-loan.balance) }}</td>
              <td class="num edit">
                <input type="text" inputmode="decimal" :value="rateFor(loan) || ''" placeholder="0" :disabled="isOff(loan)" @change="onRate(loan, $event)">
              </td>
              <td class="num edit">
                <input type="text" inputmode="decimal" :value="(paymentFor(loan) / 1000).toFixed(2)" :disabled="isOff(loan)" @change="onPayment(loan, $event)">
              </td>
              <td class="num edit">
                <input type="text" inputmode="decimal" :value="tweakFor(loan).extra ? (tweakFor(loan).extra! / 1000).toFixed(2) : ''" placeholder="0" :disabled="isOff(loan)" @change="onExtra(loan, $event)">
              </td>
              <td>
                <template v-if="isOff(loan)">—</template>
                <template v-else-if="projections.get(loan.key)?.payoffMonth">{{ dateLabel(projections.get(loan.key)!.payoffMonth!) }}</template>
                <template v-else>never at this rate</template>
              </td>
              <td class="num">
                {{ !isOff(loan) && projections.get(loan.key)?.payoffMonth ? fmt(projections.get(loan.key)!.interestTotal) : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <p class="footnote">
        Imported plans rebuild history from each export's register; live YNAB
        accounts (via your saved token) arrive with their real APR and minimum
        payment pre-filled, refreshed every half hour. Anything you type in the
        blue columns overrides the defaults and sticks in this browser.
      </p>
    </template>
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

.track {
  fill: none;
  stroke: #4a7dff;
  stroke-width: 2;
  stroke-dasharray: 6 5;
}

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

.chip {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex: none;
}

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

.warn-strip {
  margin: 1rem 0 0;
  padding: 0.6rem 0.9rem;
  border: 1px solid #ffe08a;
  background: #fff8e1;
  border-radius: 6px;
  font-size: 0.9rem;
}

.table-wrap { overflow-x: auto; }

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  min-width: 58rem;
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

.plan-name {
  margin-left: 0.45rem;
  font-size: 0.72rem;
  color: #999;
}

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

.footnote { color: #999; font-size: 0.8rem; margin-top: 1rem; }
</style>
