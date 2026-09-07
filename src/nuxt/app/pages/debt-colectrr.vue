<script setup lang="ts">
useHead({ title: 'Debt Colectrr' })
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
  userStartDate: string | null
  userStartBalance: number | null
  userName: string | null
  userBalance: number | null
  userPaidIn: number | null
  history: Array<{ month: string, balance: number }>
  hidden: boolean
}

interface LoanRow extends DebtRecord {
  color: string
  hasOverride: boolean
}

type StrategyKey = 'minimum' | 'snowball' | 'avalanche' | 'custom'

interface DebtSettings {
  strategy: StrategyKey
  snowball: number
  extra: number
  customOrder: string[]
  lumps: LumpPayment[]
}

const STRATEGY_META: Record<StrategyKey, { label: string, blurb: string }> = {
  minimum: { label: 'Minimum payments', blurb: 'Every loan pays only its own monthly — no rollover. The baseline to beat.' },
  snowball: { label: 'Snowball', blurb: 'Smallest balance first for quick wins; each payoff rolls its payment into the next.' },
  avalanche: { label: 'Avalanche', blurb: 'Highest APR first — the least total interest, mathematically optimal.' },
  custom: { label: 'Custom order', blurb: 'Your sequence — arrange exactly which loan gets attacked first.' }
}

const EXTRAS_KEY = 'ynabrr:debt:extras'
const SYNC_PLANS_KEY = 'ynabrr:debt:sync-plans'

const debts = ref<DebtRecord[]>([])
const isMock = ref(false)
const loading = ref(true)
// A panel (edit / refinance / order) locks the document behind it — on
// phones the panel is a sheet over a scrolling page, so this matters.
// Registered after mount: the refs it reads are declared further down.
onMounted(() => {
  watch(() => Boolean(editing.value || refi.value || orderModalOpen.value || lumpEdit.value), (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  })
})
onUnmounted(() => { if (import.meta.client) document.body.style.overflow = '' })

// Share of the original amount already paid — the little progress bar on
// phone loan cards.
const paidShare = (loan: LoanRow) => {
  const original = Math.abs(loan.startBalance)
  if (!original) return 0
  return Math.min(Math.max(loan.paidIn / original, 0), 1)
}
const lastSynced = ref<string | null>(null)
const extras = ref<Record<string, number>>({})
const settings = ref<DebtSettings>({ strategy: 'minimum', snowball: 0, extra: 0, customOrder: [], lumps: [] })

const syncPlans = ref<Array<{ id: string, name: string, kind: 'live' | 'import' }>>([])
const selectedPlanIds = ref<string[]>([])
const syncing = ref(false)
const syncMessage = ref('')

const importOpen = ref(false)
const importText = ref('')
const importing = ref(false)
const importMessage = ref('')

const adding = ref(false)
const addForm = ref({ name: '', original: '', balance: '0', startMonth: '', endMonth: '', rate: '', payment: '' })
const addMessage = ref('')

const orderModalOpen = ref(false)
const editing = ref<null | {
  id: string
  name: string
  startMonth: string
  original: string
  balance: string
  paidIn: string
  endMonth: string
  rate: string
  payment: string
  extraNext: string
  included: boolean
  isManual: boolean
  isPaid: boolean
  hasOverride: boolean
  baseName: string
  baseBalance: number
  basePaidIn: number
  planName: string
}>(null)

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
    if (data.settings) settings.value = { lumps: [], ...data.settings }
  } catch { /* empty state */ }
}

async function saveSettings (patch: Partial<DebtSettings>) {
  settings.value = { ...settings.value, ...patch }
  if (isMock.value) return
  try {
    await $fetch('/api/debt/settings', { method: 'PUT', body: patch })
  } catch { /* keep local value; next load re-syncs */ }
}

function selectStrategy (key: StrategyKey) {
  saveSettings({ strategy: key })
  if (key === 'custom' && !settings.value.customOrder.length) orderModalOpen.value = true
}

function onPoolInput (field: 'snowball' | 'extra', event: Event) {
  const value = Number.parseFloat((event.target as HTMLInputElement).value.replace(/[$,]/g, ''))
  saveSettings({ [field]: Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : 0 })
}

watch(extras, (value) => {
  if (!import.meta.client) return
  try {
    localStorage.setItem(EXTRAS_KEY, JSON.stringify(value))
  } catch { /* storage blocked */ }
}, { deep: true })

function togglePlan (id: string) {
  const current = selectedPlanIds.value
  if (current.includes(id)) {
    if (current.length === 1) return // the picker locks the last plan
    selectedPlanIds.value = current.filter(item => item !== id)
  } else {
    selectedPlanIds.value = syncPlans.value.map(plan => plan.id).filter(pid => current.includes(pid) || pid === id)
  }
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

const syncPickerLabel = computed(() => {
  const chosen = syncPlans.value.filter(plan => selectedPlanIds.value.includes(plan.id))
  if (!chosen.length) return 'No plans'
  return chosen.length === 1 ? chosen[0]!.name : `${chosen.length} plans`
})

// ---- Import / export -------------------------------------------------------
// Same shape both ways: decimal currency amounts (positive), months as
// YYYY-MM. Synced rows are exported for reference; on import every row
// becomes a hand-tracked debt, matched by name so re-imports update in place.
interface ExportDebt {
  name: string
  startDate: string
  endDate: string | null
  startBalance: number
  balance: number
  paidIn: number
  rate: number | null
  minimumPayment: number | null
  history: Array<{ month: string, balance: number }>
  source: DebtRecord['source']
  planName: string
}

const toUnits = (milliunits: number) => Math.round(Math.abs(milliunits)) / 1000

function exportJson () {
  const out = {
    version: 1,
    exportedAt: new Date().toISOString(),
    currency: userCurrency.value,
    debts: loans.value.filter(loan => !loan.hidden).map<ExportDebt>(loan => ({
      name: loan.name,
      startDate: loan.startDate.slice(0, 7),
      endDate: loan.endDate ? loan.endDate.slice(0, 7) : null,
      startBalance: toUnits(loan.startBalance),
      balance: toUnits(loan.balance),
      paidIn: toUnits(loan.paidIn),
      rate: loan.rate,
      minimumPayment: loan.minimumPayment == null ? null : toUnits(loan.minimumPayment),
      history: loan.history.map(point => ({ month: point.month.slice(0, 7), balance: toUnits(point.balance) })),
      source: loan.source,
      planName: loan.planName
    }))
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'debt-colectrr.json'
  a.click()
  URL.revokeObjectURL(url)
}

type ParsedImport = { debts: Array<Record<string, unknown>> | null, error: string }
const IMPORT_MONTH_RE = /^\d{4}-\d{2}(-\d{2})?$/

const parsedImport = computed<ParsedImport>(() => {
  const text = importText.value
  if (!text.trim()) return { debts: null, error: '' }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (cause) {
    return { debts: null, error: 'Not valid JSON — ' + (cause as Error).message }
  }
  // Accept the exported object or a bare array of debts.
  const list = Array.isArray(data) ? data : (data as { debts?: unknown })?.debts
  if (!Array.isArray(list)) return { debts: null, error: 'Expected { "debts": [ … ] } (or a bare array of debts).' }
  if (!list.length) return { debts: null, error: 'No debts in that JSON.' }
  for (let i = 0; i < list.length; i++) {
    const row = list[i] as Record<string, unknown>
    const label = `Debt ${i + 1}`
    if (!row || typeof row !== 'object') return { debts: null, error: `${label} isn't an object.` }
    if (typeof row.name !== 'string' || !row.name.trim()) return { debts: null, error: `${label} needs a name.` }
    const original = Math.abs(Number.parseFloat(String(row.startBalance ?? '')))
    if (!(original > 0)) return { debts: null, error: `${label} (${row.name}): startBalance must be a positive amount.` }
    const balance = Math.abs(Number.parseFloat(String(row.balance ?? 0)))
    if (Number.isNaN(balance) || balance > original) return { debts: null, error: `${label} (${row.name}): balance must be between 0 and startBalance.` }
    if (typeof row.startDate !== 'string' || !IMPORT_MONTH_RE.test(row.startDate)) return { debts: null, error: `${label} (${row.name}): startDate must be YYYY-MM.` }
    if (row.endDate && (typeof row.endDate !== 'string' || !IMPORT_MONTH_RE.test(row.endDate))) return { debts: null, error: `${label} (${row.name}): endDate must be YYYY-MM.` }
  }
  return { debts: list as Array<Record<string, unknown>>, error: '' }
})

const canImport = computed(() => Boolean(parsedImport.value.debts?.length) && !importing.value)

const importStatus = computed(() => {
  const parsed = parsedImport.value
  if (parsed.error) return parsed.error
  if (parsed.debts?.length) return `${parsed.debts.length} debt${parsed.debts.length === 1 ? '' : 's'} ready ✓`
  return 'Waiting for JSON…'
})

function pickImportFile () {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { importText.value = String(reader.result) }
    reader.readAsText(file)
  }
  input.click()
}

async function doImport () {
  const rows = parsedImport.value.debts
  if (!rows?.length || importing.value) return
  importing.value = true
  importMessage.value = ''
  try {
    const result = await $fetch<{ created: number, updated: number }>('/api/debt/import', {
      method: 'POST',
      body: { debts: rows }
    })
    importOpen.value = false
    importText.value = ''
    syncMessage.value = `Imported ${result.created} new · ${result.updated} updated`
    await loadDebts()
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    importMessage.value = err.data?.statusMessage ?? 'Import failed — check the JSON and try again.'
  } finally {
    importing.value = false
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

async function patchRow (row: { id: string }, patch: Record<string, unknown>) {
  // `loans` rows are computed copies — mutate the source record for reactivity.
  const target = debts.value.find(item => item.id === row.id)
  if (target) Object.assign(target, patch)
  if (isMock.value) return
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

// Straight ramp for the stretch before tracked history begins (user gave the
// loan's real origination) — mirrors how manual debts chart.
function rampBefore (fromMonth: string, fromBalance: number, toMonth: string, toBalance: number) {
  const months: string[] = []
  for (let key = fromMonth; key < toMonth; key = nextDebtMonth(key)) {
    months.push(key)
    if (months.length > 600) break
  }
  const span = months.length
  if (!span) return []
  return months.map((month, index) => ({
    month,
    balance: Math.round(fromBalance + ((toBalance - fromBalance) * index) / span)
  }))
}

const loans = computed<LoanRow[]>(() =>
  debts.value.map((record, index) => {
    const color = index < PALETTE.length
      ? PALETTE[index]!
      : OVERFLOW_COLORS[(index - PALETTE.length) % OVERFLOW_COLORS.length]!

    let history = record.history
    let paidIn = record.paidIn
    let startDate = record.startDate
    let startBalance = record.startBalance
    const hasOverride = Boolean(
      record.userStartDate || record.userStartBalance != null
      || record.userName || record.userBalance != null || record.userPaidIn != null
    )

    if (record.userStartDate || record.userStartBalance != null) {
      const overrideMonth = record.userStartDate ? `${record.userStartDate.slice(0, 7)}-01` : null
      const overrideBalance = record.userStartBalance ?? record.startBalance
      startDate = record.userStartDate ?? record.startDate
      startBalance = overrideBalance
      const first = record.history[0]
      if (first && overrideMonth && overrideMonth < first.month) {
        history = [...rampBefore(overrideMonth, overrideBalance, first.month, first.balance), ...record.history]
      }
      if (first) {
        paidIn = record.paidIn + Math.max(first.balance - overrideBalance, 0)
      }
    }

    // Balance override wins over the synced number — the chart's "today"
    // point moves with it so history and projection stay continuous.
    const balance = record.userBalance ?? record.balance
    if (record.userBalance != null && history.length) {
      const last = history[history.length - 1]!
      history = [...history.slice(0, -1), { month: last.month, balance: record.userBalance }]
    }
    if (record.userPaidIn != null) paidIn = record.userPaidIn

    return {
      ...record,
      name: record.userName ?? record.name,
      balance,
      history,
      paidIn,
      startDate,
      startBalance,
      color,
      hasOverride
    }
  })
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

// ---- Strategies -----------------------------------------------------------

const pooled = computed(() => settings.value.strategy !== 'minimum')
const snowballPool = computed(() => settings.value.snowball + settings.value.extra)

const customOrderIds = computed(() => {
  const active = activeLoans.value
  const kept = settings.value.customOrder.filter(id => active.some(loan => loan.id === id))
  const missing = [...active]
    .sort((a, b) => (-a.balance) - (-b.balance))
    .map(loan => loan.id)
    .filter(id => !kept.includes(id))
  return [...kept, ...missing]
})

function orderedLoans (key: StrategyKey): LoanRow[] {
  const active = activeLoans.value
  if (key === 'snowball') return [...active].sort((a, b) => (-a.balance) - (-b.balance))
  if (key === 'avalanche') return [...active].sort((a, b) => (rateFor(b) - rateFor(a)) || ((-a.balance) - (-b.balance)))
  if (key === 'custom') {
    return customOrderIds.value
      .map(id => active.find(loan => loan.id === id))
      .filter((loan): loan is LoanRow => Boolean(loan))
  }
  return active
}

interface JourneyLoan {
  id: string
  balance: number
  annualRatePct: number
  minimum: number
  extraFirstMonth?: number
}

// Projections start the month after the latest synced balance.
const journeyStart = computed(() => todayMonth.value ? nextDebtMonth(todayMonth.value) : '')

// Every scheduled lump payment unrolled into concrete future hits.
const journeyHits = computed(() => expandLumpPayments(settings.value.lumps, journeyStart.value))

type JourneyResult = { map: Map<string, PayoffProjection>, debtFree: string | null, interest: number }

// One engine for every "how does the whole journey look" question — the
// strategy cards, the refinance comparison and the lump-sum what-ifs all
// run through here.
function runJourney (key: StrategyKey, loanSet: JourneyLoan[], customIds?: string[], hits: LumpHit[] = journeyHits.value): JourneyResult {
  const start = journeyStart.value
  const map = new Map<string, PayoffProjection>()
  if (!start || !loanSet.length) return { map, debtFree: null, interest: 0 }

  if (key === 'minimum') {
    // No rollover, no pool — only lump sums cascade, highest APR first.
    const result = projectSnowball({
      loans: [...loanSet].sort((a, b) => (b.annualRatePct - a.annualRatePct) || (a.balance - b.balance)),
      pool: 0,
      order: 'given',
      fromMonth: start,
      lumps: hits,
      rollover: false
    })
    for (const [id, projection] of Object.entries(result.perLoan)) map.set(id, projection)
    return { map, debtFree: result.debtFree, interest: result.interestTotal }
  }

  let ordered = loanSet
  if (key === 'snowball') ordered = [...loanSet].sort((a, b) => a.balance - b.balance)
  else if (key === 'avalanche') ordered = [...loanSet].sort((a, b) => (b.annualRatePct - a.annualRatePct) || (a.balance - b.balance))
  else if (key === 'custom' && customIds) {
    const byId = new Map(loanSet.map(loan => [loan.id, loan]))
    const picked = customIds.map(id => byId.get(id)).filter((loan): loan is JourneyLoan => Boolean(loan))
    const rest = loanSet.filter(loan => !customIds.includes(loan.id))
    ordered = [...picked, ...rest]
  }

  const result = projectSnowball({
    loans: ordered,
    pool: snowballPool.value,
    order: 'given',
    fromMonth: start,
    lumps: hits
  })
  for (const [id, projection] of Object.entries(result.perLoan)) map.set(id, projection)
  return { map, debtFree: result.debtFree, interest: result.interestTotal }
}

const toJourneyLoan = (loan: LoanRow): JourneyLoan => ({
  id: loan.id,
  balance: -loan.balance,
  annualRatePct: rateFor(loan),
  minimum: paymentFor(loan),
  extraFirstMonth: extras.value[loan.id]
})

function strategyResult (key: StrategyKey, hits?: LumpHit[]): JourneyResult {
  return runJourney(key, activeLoans.value.map(toJourneyLoan), customOrderIds.value, hits)
}

const strategyCards = computed(() =>
  (['minimum', 'snowball', 'avalanche', 'custom'] as StrategyKey[]).map(key => ({
    key,
    ...STRATEGY_META[key],
    result: strategyResult(key)
  }))
)

const selectedResult = computed(() => strategyResult(settings.value.strategy))
const projections = computed(() => selectedResult.value.map)
const debtFreeMonth = computed(() => selectedResult.value.debtFree)
const totalInterest = computed(() => selectedResult.value.interest)

// ---- One-time payments ----------------------------------------------------
// Bonuses, refunds, gifts: dated lump sums (optionally repeating) that the
// forecast folds in on top of the monthly plan. Saved with the settings.

const LUMP_META: Record<LumpKind, { icon: string, label: string, hint: string, blurb: string }> = {
  bonus: { icon: '💼', label: 'Bonus', hint: 'Annual bonus', blurb: 'Work bonus — once, or every year or quarter.' },
  refund: { icon: '🧾', label: 'Tax refund', hint: 'Tax refund', blurb: 'The refund lands, the debt shrinks.' },
  gift: { icon: '🎁', label: 'Gift', hint: 'Gift', blurb: 'Money from family or friends.' },
  sale: { icon: '🏷️', label: 'Sale', hint: 'Sold the old car', blurb: 'Proceeds from selling something.' },
  boost: { icon: '📈', label: 'Monthly boost', hint: 'Side gig', blurb: 'Extra every month for a while — a side gig, a paused expense.' },
  other: { icon: '✨', label: 'Windfall', hint: 'Windfall', blurb: 'Anything else that lands on the debt.' }
}

const lumpEdit = ref<null | {
  id: string | null
  kind: LumpKind
  label: string
  amount: string
  month: string
  repeat: 'once' | 'every'
  every: string
  times: string
  loanId: string
}>(null)

function openLump (id: string | null) {
  const existing = id ? settings.value.lumps.find(lump => lump.id === id) : null
  const defaultMonth = journeyStart.value || `${new Date().toISOString().slice(0, 7)}-01`
  lumpEdit.value = existing
    ? {
        id: existing.id,
        kind: existing.kind,
        label: existing.label,
        amount: (existing.amount / 1000).toFixed(2),
        month: existing.month.slice(0, 7),
        repeat: existing.every > 0 ? 'every' : 'once',
        every: existing.every > 0 ? String(existing.every) : '12',
        times: existing.times > 0 ? String(existing.times) : '',
        loanId: existing.loanId ?? ''
      }
    : { id: null, kind: 'bonus', label: '', amount: '', month: defaultMonth.slice(0, 7), repeat: 'once', every: '12', times: '', loanId: '' }
}

// Switching kind swaps the shape of the form; a boost is monthly by nature.
function setLumpKind (kind: LumpKind) {
  const edit = lumpEdit.value
  if (!edit) return
  edit.kind = kind
  if (kind === 'boost') {
    edit.repeat = 'every'
    edit.every = '1'
    if (!edit.times) edit.times = '6'
  } else if (edit.every === '1') {
    edit.repeat = 'once'
    edit.every = '12'
    edit.times = ''
  }
}

// The editor's current values as a lump — null until the form makes sense.
const lumpDraft = computed<LumpPayment | null>(() => {
  const edit = lumpEdit.value
  if (!edit) return null
  const amount = Number.parseFloat(edit.amount.replace(/[$,]/g, ''))
  if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}$/.test(edit.month)) return null
  const boost = edit.kind === 'boost'
  const every = boost ? 1 : edit.repeat === 'every' ? Math.floor(Number(edit.every)) : 0
  const times = boost || edit.repeat === 'every' ? Math.floor(Number(edit.times)) : 0
  return {
    id: edit.id ?? `lump-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: edit.kind,
    label: edit.label.trim().slice(0, 60),
    amount: Math.round(amount * 1000),
    month: `${edit.month}-01`,
    every: Number.isFinite(every) && every > 0 ? Math.min(every, 120) : 0,
    times: Number.isFinite(times) && times > 0 ? Math.min(times, 600) : 0,
    loanId: edit.loanId && activeLoans.value.some(loan => loan.id === edit.loanId) ? edit.loanId : null
  }
})

// The hits that actually land before the journey ends — an open-ended
// bonus is unrolled to the horizon, but only the ones before debt-free
// (or before the projection gave up) count.
function landedHits (hits: LumpHit[], result: JourneyResult): LumpHit[] {
  let end = result.debtFree ?? ''
  if (!end) {
    for (const projection of result.map.values()) {
      const last = projection.months[projection.months.length - 1] ?? ''
      if (last > end) end = last
    }
  }
  return hits.filter(hit => hit.month <= end)
}

// Live preview inside the editor: the journey with this draft in place
// versus the same journey without it.
const lumpDraftEffect = computed(() => {
  const draft = lumpDraft.value
  if (!draft || !activeLoans.value.length) return null
  const others = settings.value.lumps.filter(lump => lump.id !== draft.id)
  const without = strategyResult(settings.value.strategy, expandLumpPayments(others, journeyStart.value))
  const withDraft = strategyResult(settings.value.strategy, expandLumpPayments([...others, draft], journeyStart.value))
  const landed = landedHits(expandLumpPayments([draft], journeyStart.value), withDraft)
  return {
    hits: landed.length,
    total: landed.reduce((sum, hit) => sum + hit.amount, 0),
    without,
    withDraft,
    monthsSooner: without.debtFree && withDraft.debtFree ? monthDiff(withDraft.debtFree, without.debtFree) : null,
    interestSaved: without.debtFree && withDraft.debtFree ? without.interest - withDraft.interest : null
  }
})

function saveLump () {
  const draft = lumpDraft.value
  if (!draft) return
  const lumps = settings.value.lumps.filter(lump => lump.id !== draft.id)
  lumps.push(draft)
  lumps.sort((a, b) => a.month.localeCompare(b.month))
  saveSettings({ lumps })
  lumpEdit.value = null
}

function deleteLump () {
  const id = lumpEdit.value?.id
  if (id) saveSettings({ lumps: settings.value.lumps.filter(lump => lump.id !== id) })
  lumpEdit.value = null
}

const loanNameById = computed(() => new Map(loans.value.map(loan => [loan.id, loan.name])))

// Chips under the strategy bar, one per scheduled lump, each with what it
// does on its own (the plan with everything else, minus just this one).
const lumpChips = computed(() => settings.value.lumps.map((lump) => {
  const upcoming = expandLumpPayments([lump], journeyStart.value)
  const parts: string[] = []
  if (lump.kind === 'boost') {
    parts.push(`${fmt(lump.amount)}/mo`, lump.times ? `for ${lump.times} mo from ${shortMonth(lump.month)}` : `from ${shortMonth(lump.month)} until debt-free`)
  } else {
    parts.push(fmt(lump.amount))
    if (lump.every > 0) parts.push(`every ${lump.every === 12 ? 'year' : `${lump.every} mo`} from ${shortMonth(lump.month)}${lump.times ? ` ×${lump.times}` : ''}`)
    else parts.push(shortMonth(lump.month))
  }
  if (lump.loanId) parts.push(`→ ${loanNameById.value.get(lump.loanId) ?? 'a loan that\'s gone'}`)

  let effect = ''
  if (upcoming.length && activeLoans.value.length) {
    const others = settings.value.lumps.filter(item => item.id !== lump.id)
    const without = strategyResult(settings.value.strategy, expandLumpPayments(others, journeyStart.value))
    const withAll = selectedResult.value
    if (without.debtFree && withAll.debtFree) {
      const diff = monthDiff(withAll.debtFree, without.debtFree)
      const saved = without.interest - withAll.interest
      effect = diff ? monthsSooner(diff) : saved > 0 ? `${fmt(saved)} less interest` : 'no change'
    } else if (withAll.debtFree) {
      effect = 'what makes debt-free reachable'
    }
  }
  return {
    id: lump.id,
    icon: LUMP_META[lump.kind].icon,
    label: lump.label || LUMP_META[lump.kind].label,
    detail: parts.join(' · '),
    effect,
    past: upcoming.length === 0
  }
}))

// What every scheduled lump does to the chosen plan, together.
const lumpEffect = computed(() => {
  if (!journeyHits.value.length || !activeLoans.value.length) return null
  const without = strategyResult(settings.value.strategy, [])
  const withLumps = selectedResult.value
  const landed = landedHits(journeyHits.value, withLumps)
  return {
    hits: landed.length,
    total: landed.reduce((sum, hit) => sum + hit.amount, 0),
    without,
    withLumps,
    monthsSooner: without.debtFree && withLumps.debtFree ? monthDiff(withLumps.debtFree, without.debtFree) : null,
    interestSaved: without.debtFree && withLumps.debtFree ? without.interest - withLumps.interest : null
  }
})

// ---- Order flyout ---------------------------------------------------------

const orderDragIdx = ref<number | null>(null)

const customLoansOrdered = computed(() => orderedLoans('custom'))
const customResult = computed(() => strategyResult('custom'))

function commitOrder (ids: string[]) {
  saveSettings({ customOrder: ids, strategy: 'custom' })
}

function moveOrder (index: number, direction: -1 | 1) {
  const ids = customLoansOrdered.value.map(loan => loan.id)
  const target = index + direction
  if (target < 0 || target >= ids.length) return
  const moved = ids[index]!
  ids[index] = ids[target]!
  ids[target] = moved
  commitOrder(ids)
}

function onOrderDrop (dropIdx: number) {
  if (orderDragIdx.value === null || orderDragIdx.value === dropIdx) {
    orderDragIdx.value = null
    return
  }
  const ids = customLoansOrdered.value.map(loan => loan.id)
  const [moved] = ids.splice(orderDragIdx.value, 1)
  ids.splice(dropIdx, 0, moved!)
  orderDragIdx.value = null
  commitOrder(ids)
}

// ---- Reconciliation -------------------------------------------------------
// original − paid in should equal the balance. Higher-than-expected balance
// is usually accrued interest/fees (informational); lower is a data error.

function reconcile (loan: { startBalance: number, balance: number, paidIn: number }) {
  const original = -loan.startBalance
  if (original <= 0) return null
  const expected = original - loan.paidIn
  const actual = -loan.balance
  return { expected, actual, gap: actual - expected }
}

function reconcileState (loan: { startBalance: number, balance: number, paidIn: number }): 'ok' | 'interest' | 'error' {
  const result = reconcile(loan)
  if (!result) return 'ok'
  if (result.gap < -1_000) return 'error'
  if (result.gap > Math.max(1_000, -loan.startBalance * 0.005)) return 'interest'
  return 'ok'
}

const editorReconcile = computed(() => {
  const edit = editing.value
  if (!edit) return null
  const money = (value: string) => Number.parseFloat(value.replace(/[$,]/g, ''))
  const original = money(edit.original)
  const balance = money(edit.balance)
  const paidIn = money(edit.paidIn)
  if (![original, balance, paidIn].every(Number.isFinite) || original <= 0) return null
  const expected = original - paidIn
  const gap = balance - expected
  if (Math.abs(gap) <= 1) {
    return { tone: 'ok', text: `✓ These line up: ${usd.value.format(original)} − ${usd.value.format(paidIn)} paid = ${usd.value.format(balance)}` }
  }
  if (gap < 0) {
    return { tone: 'error', text: `⚠ Doesn't add up: original − paid in = ${usd.value.format(expected)}, but the balance is ${usd.value.format(balance)} — ${usd.value.format(-gap)} more paid than the loan shrank. Check the numbers.` }
  }
  return { tone: 'info', text: `Balance runs ${usd.value.format(gap)} above original − paid in — that's usually accrued interest and fees.` }
})

// ---- Refinance calculator -------------------------------------------------

const refi = ref<null | {
  bundleIds: string[]
  newRate: string
  newPayment: string
  fee: string
  feeRolled: boolean
  cashOut: string
}>(null)

function openRefi (loan: LoanRow) {
  refi.value = {
    bundleIds: [loan.id],
    newRate: '',
    newPayment: (paymentFor(loan) / 1000).toFixed(2),
    fee: '0',
    feeRolled: true,
    cashOut: '0'
  }
}

function toggleBundle (id: string) {
  const model = refi.value
  if (!model) return
  model.bundleIds = model.bundleIds.includes(id)
    ? model.bundleIds.filter(item => item !== id)
    : [...model.bundleIds, id]
}

const refiBundle = computed(() =>
  activeLoans.value.filter(loan => refi.value?.bundleIds.includes(loan.id))
)

function useBundleMinimums () {
  const model = refi.value
  if (!model) return
  const combined = refiBundle.value.reduce((sum, loan) => sum + paymentFor(loan), 0)
  model.newPayment = (combined / 1000).toFixed(2)
}

// Journey-level comparison: today's plan (current strategy + pool) versus
// the same strategy with the bundled debts replaced by one new loan.
const refiModel = computed(() => {
  const model = refi.value
  if (!model || !todayMonth.value) return null
  const bundle = refiBundle.value
  if (!bundle.length) return null

  const money = (value: string) => {
    const parsed = Number.parseFloat(value.replace(/[$,]/g, ''))
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1000) : 0
  }
  const newRate = Number.parseFloat(model.newRate)
  const fee = money(model.fee)
  const cashOut = money(model.cashOut)
  const newPayment = money(model.newPayment)

  const bundleBalance = bundle.reduce((sum, loan) => sum - loan.balance, 0)
  const bundleMinimums = bundle.reduce((sum, loan) => sum + paymentFor(loan), 0)
  const principal = bundleBalance + (model.feeRolled ? fee : 0) + cashOut

  const remaining = activeLoans.value
    .filter(loan => !model.bundleIds.includes(loan.id))
    .map(toJourneyLoan)
  const newLoan: JourneyLoan = {
    id: '__refi__',
    balance: principal,
    annualRatePct: Number.isFinite(newRate) && newRate > 0 ? newRate : 0,
    minimum: newPayment
  }

  const key = settings.value.strategy
  const currentJourney = selectedResult.value
  const customIds = [
    ...customOrderIds.value.filter(id => !model.bundleIds.includes(id)),
    '__refi__'
  ]
  const hits = journeyHits.value.map(hit =>
    hit.loanId && model.bundleIds.includes(hit.loanId) ? { ...hit, loanId: '__refi__' } : hit
  )
  const newJourney = runJourney(key, [...remaining, newLoan], customIds, hits)

  const minsCurrent = totalMinimums.value
  const minsNew = minsCurrent - bundleMinimums + newPayment

  const currentCost = currentJourney.debtFree ? currentJourney.interest : null
  const newCost = newJourney.debtFree ? newJourney.interest + fee : null
  const savings = currentCost !== null && newCost !== null ? currentCost - newCost : null
  const monthsSooner = currentJourney.debtFree && newJourney.debtFree
    ? monthDiff(newJourney.debtFree, currentJourney.debtFree)
    : null

  return {
    bundle,
    bundleBalance,
    bundleMinimums,
    principal,
    fee,
    cashOut,
    currentJourney,
    newJourney,
    newLoanPayoff: newJourney.map.get('__refi__')?.payoffMonth ?? null,
    minsCurrent,
    minsNew,
    currentCost,
    newCost,
    savings,
    monthsSooner
  }
})

// ---- Row editor flyout ----------------------------------------------------

function openEditor (loan: LoanRow) {
  const raw = debts.value.find(item => item.id === loan.id)
  if (!raw) return
  const effectiveDate = raw.userStartDate ?? raw.startDate
  const effectiveOriginal = raw.userStartBalance ?? raw.startBalance
  editing.value = {
    id: raw.id,
    name: raw.userName ?? raw.name,
    startMonth: effectiveDate ? effectiveDate.slice(0, 7) : '',
    original: effectiveOriginal ? (-effectiveOriginal / 1000).toFixed(2) : '',
    balance: (-(raw.userBalance ?? raw.balance) / 1000).toFixed(2),
    paidIn: ((loan.paidIn) / 1000).toFixed(2),
    endMonth: raw.endDate ? raw.endDate.slice(0, 7) : '',
    rate: raw.rate != null ? String(raw.rate) : '',
    payment: raw.minimumPayment != null ? (raw.minimumPayment / 1000).toFixed(2) : '',
    extraNext: extras.value[raw.id] ? (extras.value[raw.id]! / 1000).toFixed(2) : '',
    included: !raw.hidden,
    isManual: raw.source === 'manual',
    isPaid: (raw.userBalance ?? raw.balance) >= 0,
    hasOverride: loan.hasOverride,
    baseName: raw.name,
    baseBalance: raw.balance,
    // Paid-in before any explicit override (synced value + pre-tracking ramp)
    basePaidIn: (() => {
      let base = raw.paidIn
      if ((raw.userStartDate || raw.userStartBalance != null) && raw.history[0]) {
        base += Math.max(raw.history[0].balance - (raw.userStartBalance ?? raw.startBalance), 0)
      }
      return base
    })(),
    planName: raw.planName
  }
}

async function saveEditor () {
  const edit = editing.value
  if (!edit) return
  const raw = debts.value.find(item => item.id === edit.id)
  if (!raw) { editing.value = null; return }
  const money = (value: string) => Number.parseFloat(value.replace(/[$,]/g, ''))

  // One-time "extra next month" what-if — browser-local, applied per loan.
  const extraNext = money(edit.extraNext)
  if (Number.isFinite(extraNext) && extraNext > 0) extras.value[edit.id] = Math.round(extraNext * 1000)
  else delete extras.value[edit.id]
  const rate = Number.parseFloat(edit.rate)
  const payment = money(edit.payment)
  const paidInInput = money(edit.paidIn)

  if (edit.isManual) {
    const patch: Record<string, unknown> = {
      manualShape: {
        original: money(edit.original),
        balance: Number.isFinite(money(edit.balance)) ? money(edit.balance) : 0,
        startMonth: edit.startMonth,
        endMonth: edit.endMonth || null
      },
      rate: Number.isFinite(rate) && rate > 0 ? rate : null,
      minimumPayment: Number.isFinite(payment) && payment > 0 ? Math.round(payment * 1000) : null,
      hidden: !edit.included,
      // Paid-in normally derives from original − balance; a differing entry
      // becomes an explicit override.
      userPaidIn: Number.isFinite(paidInInput) && Math.round(paidInInput * 1000) !== Math.max(money(edit.balance) * -1000 + money(edit.original) * 1000, 0)
        ? Math.round(paidInInput * 1000)
        : null
    }
    if (edit.name.trim()) patch.name = edit.name.trim()
    const target = debts.value.find(item => item.id === edit.id)
    if (isMock.value && target) {
      Object.assign(target, {
        name: edit.name.trim() || target.name,
        rate: patch.rate,
        minimumPayment: patch.minimumPayment,
        hidden: !edit.included
      })
    } else {
      try {
        await $fetch(`/api/debt/${edit.id}`, { method: 'PATCH', body: patch })
      } catch { /* reload below re-syncs */ }
      await loadDebts()
    }
    editing.value = null
    return
  }

  const original = money(edit.original)
  const balanceInput = money(edit.balance)
  const name = edit.name.trim()
  await patchRow({ id: edit.id }, {
    userStartDate: edit.startMonth ? `${edit.startMonth}-01` : null,
    userStartBalance: Number.isFinite(original) && original > 0 ? -Math.round(original * 1000) : null,
    userName: name && name !== edit.baseName ? name : null,
    userBalance: Number.isFinite(balanceInput) && -Math.round(balanceInput * 1000) !== edit.baseBalance
      ? -Math.round(balanceInput * 1000)
      : null,
    userPaidIn: Number.isFinite(paidInInput) && Math.round(paidInInput * 1000) !== edit.basePaidIn
      ? Math.round(paidInInput * 1000)
      : null,
    rate: Number.isFinite(rate) && rate > 0 ? rate : null,
    minimumPayment: Number.isFinite(payment) && payment > 0 ? Math.round(payment * 1000) : null,
    hidden: !edit.included
  })
  editing.value = null
}

async function clearEditorOverride () {
  const edit = editing.value
  if (!edit) return
  await patchRow({ id: edit.id }, {
    userStartDate: null,
    userStartBalance: null,
    userName: null,
    userBalance: null,
    userPaidIn: null
  })
  editing.value = null
}

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
  lumpMarks: Array<{ x: number, y: number, month: string, amount: number }>
  boostSpans: Array<{ x1: number, x2: number, label: string }>
  lumpByMonth: Map<string, number>
  boostByMonth: Map<string, number>
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
      // A loan that never amortizes stops where the projection gave up —
      // hold it there rather than letting the band drop to zero.
      if (projection && !projection.payoffMonth) {
        return Math.max(projection.balances[projection.balances.length - 1] ?? -loan.balance, 0)
      }
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

  const lumpByMonth = new Map<string, number>()
  const boostByMonth = new Map<string, number>()
  for (const hit of journeyHits.value) {
    const target = hit.kind === 'boost' ? boostByMonth : lumpByMonth
    target.set(hit.month, (target.get(hit.month) ?? 0) + hit.amount)
  }
  const lumpMarks: ChartModel['lumpMarks'] = []
  for (const [month, amount] of lumpByMonth) {
    const index = months.indexOf(month)
    if (index > todayIdx && totals[index]! > 0) lumpMarks.push({ x: x(index), y: y(totals[index]!), month, amount })
  }
  // A boost is a stretch, not a point: one bracket per boost across the
  // months it's active (clipped to the chart).
  const boostSpans: ChartModel['boostSpans'] = []
  for (const lump of settings.value.lumps) {
    if (lump.kind !== 'boost') continue
    const hits = expandLumpPayments([lump], journeyStart.value).filter(hit => months.includes(hit.month) && boostByMonth.has(hit.month))
    if (!hits.length) continue
    const first = months.indexOf(hits[0]!.month)
    const last = months.indexOf(hits[hits.length - 1]!.month)
    boostSpans.push({ x1: x(first), x2: x(last), label: `${lump.label || LUMP_META.boost.label}: ${fmt(lump.amount)}/mo` })
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
    totals,
    lumpMarks,
    boostSpans,
    lumpByMonth,
    boostByMonth
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
// Every visible loan's original amount, trophies included — all the debt
// you've ever carried here. (Overrides already resolved in `loans`.)
const totalBorrowed = computed(() => visibleLoans.value.reduce((sum, loan) => sum + Math.abs(loan.startBalance), 0))
const totalMinimums = computed(() => activeLoans.value.reduce((sum, loan) => sum + paymentFor(loan), 0))
const totalPayment = computed(() =>
  pooled.value ? totalMinimums.value + snowballPool.value : totalMinimums.value
)
const stuckLoans = computed(() =>
  activeLoans.value.filter(loan => !projections.value.get(loan.id)?.payoffMonth)
)

// Debts are largely hand-tracked, so they follow the Account currency
// preference rather than any one budget's currency.
const { format: formatMoney, userCurrency } = useMoney()
const usd = computed(() => new Intl.NumberFormat('en-US', { style: 'currency', currency: userCurrency.value }))
const fmt = (milliunits: number) => formatMoney(milliunits)
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

const monthsSooner = (months: number) => {
  if (!months) return 'the same month'
  const abs = Math.abs(months)
  const years = Math.floor(abs / 12)
  const rem = abs % 12
  const span = years && rem ? `${years} yr, ${rem} mo` : years ? `${years} yr` : `${rem} mo`
  return `${span} ${months > 0 ? 'sooner' : 'later'}`
}

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

const strategyLabel = computed(() => STRATEGY_META[settings.value.strategy].label)

</script>

<template>
  <main class="page">
    <header class="top">
      <div class="title-row">
        <h1>Debt Colectrr</h1>
        <NuxtLink to="/remembrr" class="story-link">Remembrr — the story so far →</NuxtLink>
        <span v-if="isMock" class="badge" title="Serving built-in sample data — no YNAB account is being read">Mock data</span>
        <div v-if="!loading" class="top-actions">
          <button v-if="!isMock" class="y-btn-outline" @click="importOpen = true; importMessage = ''">⇪ Import JSON</button>
          <button v-if="loans.length" class="y-btn-secondary" @click="exportJson">⇓ Export JSON</button>
        </div>
      </div>
      <p class="tagline">
        Every loan's real history — synced from YNAB or added by hand — then
        the road ahead. Pick a payoff strategy and bend the curve.
      </p>
    </header>

    <section v-if="!isMock && !loading" class="sync-bar">
      <span class="picker-label">Sync from</span>
      <template v-if="syncPlans.length">
        <PlanPicker
          :plans="syncPlans"
          :selected="selectedPlanIds"
          :label="syncPickerLabel"
          caption="Sync from"
          note="Loan accounts from every selected plan are pulled in."
          @toggle="togglePlan"
        />
        <button class="primary" :disabled="syncing || !selectedPlanIds.length" @click="syncNow">
          {{ syncing ? 'Syncing…' : 'Sync now' }}
        </button>
      </template>
      <span v-else class="muted">
        No YNAB connected — this page works fine without it (add debts by hand
        below), or connect a token / import a zip on
        <NuxtLink to="/account">your account</NuxtLink>.
      </span>
      <span v-if="syncMessage" class="sync-msg">{{ syncMessage }}</span>
      <span v-else-if="syncedLabel" class="muted">last synced {{ syncedLabel }}</span>
    </section>

    <p v-if="loading" class="status">Loading debt history…</p>

    <section v-else-if="!loans.length" class="status">
      <h2>No debts tracked yet</h2>
      <p v-if="!authUser && !isMock">
        <NuxtLink to="/login">Sign in</NuxtLink> (just an email — no YNAB needed)
        and add your debts by hand below. If you do use YNAB, connect a token or
        import an export on your account page and <em>Sync now</em> pulls them in.
      </p>
      <p v-else-if="syncPlans.length">
        Hit <em>Sync now</em> above to pull loans from your plans, or add one by
        hand below — paid-off debts welcome too.
      </p>
      <p v-else>
        Add your debts by hand below — name, amount, dates — and everything here
        works: the burndown, strategies, and the refinance tool. YNAB optional.
      </p>
    </section>

    <template v-else>
      <section class="stats">
        <article>
          <h3>Remaining debt</h3>
          <p>{{ fmt(totalBalance) }}</p>
          <p class="sub">across {{ activeLoans.length }} active {{ activeLoans.length === 1 ? 'loan' : 'loans' }}</p>
          <p class="sub borrowed">{{ fmt(totalBorrowed) }} borrowed all-time</p>
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
            <template v-if="pooled">{{ fmt(totalMinimums) }} minimums + {{ fmt(snowballPool) }} snowball</template>
            <template v-else>minimums only, editable in the panel</template>
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

      <section class="strategies">
        <button
          v-for="card in strategyCards"
          :key="card.key"
          class="strategy-card"
          :class="{ on: settings.strategy === card.key }"
          @click="selectStrategy(card.key)"
        >
          <span class="strat-name">{{ card.label }}</span>
          <span class="strat-blurb">{{ card.blurb }}</span>
          <span class="strat-result">
            <template v-if="card.result.debtFree">
              <strong>{{ dateLabel(card.result.debtFree) }}</strong>
              · {{ fmt(card.result.interest) }} interest
            </template>
            <template v-else-if="activeLoans.length">never at these payments</template>
            <template v-else>—</template>
          </span>
        </button>
      </section>

      <section class="strategy-bar">
        <template v-if="pooled">
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
          <button v-if="settings.strategy === 'custom'" class="ghost-btn" @click="orderModalOpen = true">
            Arrange order…
          </button>
        </template>
        <span v-else class="muted">
          Add a snowball on one of the rollover strategies to see how much faster this could go.
        </span>
      </section>

      <section class="lumps-bar" aria-label="One-time payments and boosts">
        <span class="lumps-label" title="Bonuses, refunds, gifts, temporary monthly boosts — stack as many as you like; every forecast on this page folds them in">
          One-time payments &amp; boosts
        </span>
        <button
          v-for="chip in lumpChips"
          :key="chip.id"
          class="lump-chip"
          :class="{ past: chip.past }"
          :title="chip.past ? 'Already behind us — no future hits. Click to edit or remove.' : `Edit · on its own: ${chip.effect || '—'}`"
          @click="openLump(chip.id)"
        >
          <span class="lump-icon" aria-hidden="true">{{ chip.icon }}</span>
          <strong>{{ chip.label }}</strong> <span>{{ chip.detail }}</span>
          <em v-if="chip.effect && !chip.past">{{ chip.effect }}</em>
        </button>
        <button class="ghost-btn" :disabled="!activeLoans.length" @click="openLump(null)">
          {{ lumpChips.length ? '+ Add another' : '+ Add a bonus, refund, or monthly boost' }}
        </button>
        <span v-if="!lumpChips.length && activeLoans.length" class="muted">
          Stack as many as you like — each one shows what it does on its own.
        </span>
        <span v-if="lumpEffect" class="lumps-effect">
          <template v-if="lumpEffect.monthsSooner !== null">
            {{ fmt(lumpEffect.total) }} across {{ lumpEffect.hits }} {{ lumpEffect.hits === 1 ? 'payment' : 'payments' }}
            → debt-free <strong>{{ monthsSooner(lumpEffect.monthsSooner) }}</strong>
            <template v-if="lumpEffect.interestSaved"> · {{ fmt(Math.abs(lumpEffect.interestSaved)) }} {{ lumpEffect.interestSaved > 0 ? 'less' : 'more' }} interest</template>
          </template>
          <template v-else-if="lumpEffect.withLumps.debtFree">
            {{ fmt(lumpEffect.total) }} across {{ lumpEffect.hits }} {{ lumpEffect.hits === 1 ? 'payment' : 'payments' }}
            is what gets this plan to debt-free at all — <strong>{{ dateLabel(lumpEffect.withLumps.debtFree) }}</strong>.
          </template>
        </span>
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
          <g v-for="(span, i) in chart.boostSpans" :key="`b${i}`" class="boost-span">
            <title>{{ span.label }}</title>
            <line :x1="span.x1" :x2="span.x2" :y1="CHART.top + 4" :y2="CHART.top + 4" />
            <line :x1="span.x1" :x2="span.x1" :y1="CHART.top + 1" :y2="CHART.top + 7" />
            <line :x1="span.x2" :x2="span.x2" :y1="CHART.top + 1" :y2="CHART.top + 7" />
          </g>
          <g v-for="mark in chart.lumpMarks" :key="`l${mark.month}`" class="lump-mark">
            <title>{{ shortMonth(mark.month) }}: {{ fmt(mark.amount) }} one-time</title>
            <line :x1="mark.x" :x2="mark.x" :y1="mark.y - 4" :y2="mark.y - 16" />
            <path :d="`M${mark.x - 5},${mark.y - 22}L${mark.x + 5},${mark.y - 22}L${mark.x},${mark.y - 15}Z`" />
          </g>
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
          <p v-if="chart!.lumpByMonth.has(hover.month)" class="tip-row tip-lump">
            <span class="tip-name">One-time payment</span>
            <span class="tip-value">+{{ fmt(chart!.lumpByMonth.get(hover.month)!) }}</span>
          </p>
          <p v-if="chart!.boostByMonth.has(hover.month)" class="tip-row tip-lump">
            <span class="tip-name">Monthly boost</span>
            <span class="tip-value">+{{ fmt(chart!.boostByMonth.get(hover.month)!) }}</span>
          </p>
        </div>

        <div class="legend">
          <span v-for="loan in visibleLoans" :key="loan.id" class="legend-item">
            <span class="chip" :style="{ background: loan.color }" />
            {{ loan.name }}<template v-if="loan.balance >= 0"> ✓</template>
          </span>
          <span class="legend-item muted"><span class="chip solid" /> actual</span>
          <span class="legend-item muted"><span class="chip dashed" /> projected</span>
          <span v-if="chart.lumpMarks.length" class="legend-item muted"><span class="chip lump" /> one-time payment</span>
          <span v-if="chart.boostSpans.length" class="legend-item muted"><span class="chip boost" /> monthly boost</span>
        </div>

        <p v-if="debtFreeMonth && pooled" class="payoff-strip">
          <strong>{{ strategyLabel }}</strong>: {{ fmt(snowballPool) }} on top of {{ fmt(totalMinimums) }}
          in minimums clears everything by <strong>{{ monthLabel(debtFreeMonth) }}</strong> —
          {{ timeUntil(debtFreeMonth) }} from now. As each loan falls, its payment rolls into the next.
        </p>
        <p v-else-if="debtFreeMonth" class="payoff-strip">
          Paying minimums only clears everything by <strong>{{ monthLabel(debtFreeMonth) }}</strong>
          — {{ timeUntil(debtFreeMonth) }} from now.
        </p>
        <p v-else-if="stuckLoans.length" class="payoff-strip warn">
          {{ stuckLoans.map(loan => loan.name).join(', ') }}
          {{ stuckLoans.length === 1 ? "doesn't" : "don't" }} amortize at the current
          payment — raise the monthly amount below or add a snowball.
        </p>
      </section>

      <section class="loan-cards">
        <article v-for="loan in loans" :key="loan.id" class="loan-card" :class="{ off: loan.hidden }">
          <div class="lc-head">
            <input type="checkbox" class="lc-check" :checked="!loan.hidden" :aria-label="`Include ${loan.name}`" @change="patchRow(loan, { hidden: !loan.hidden })">
            <span class="chip" :style="{ background: loan.color }" />
            <div class="lc-who">
              <div class="lc-name">{{ loan.name }}<span v-if="loan.hasOverride" class="override-mark" title="Adjusted by you — sync keeps it">*</span></div>
              <div class="lc-plan">{{ loan.source === 'manual' ? 'manual' : loan.planName }}<template v-if="loan.startDate"> · since {{ dateLabel(loan.startDate) }}</template></div>
            </div>
            <div class="lc-balance" :class="{ paid: loan.balance >= 0 }">{{ loan.balance < 0 ? fmt(-loan.balance) : 'Paid ✓' }}</div>
          </div>
          <div class="lc-bar" :title="`${Math.round(paidShare(loan) * 100)}% paid`"><div class="lc-fill" :style="{ width: `${paidShare(loan) * 100}%`, background: loan.color }" /></div>
          <div class="lc-grid">
            <div>Original <b>{{ fmt(-loan.startBalance) }}</b></div>
            <div>Paid in <b>{{ fmt(loan.paidIn) }}<span v-if="reconcileState(loan) === 'error'" class="recon-error" title="Doesn't add up — edit this row to fix">⚠</span></b></div>
            <div>APR <b>{{ loan.balance < 0 && loan.rate ? `${loan.rate}%` : '—' }}</b></div>
            <div>Monthly <b class="teal"><template v-if="loan.balance < 0">{{ fmt(paymentFor(loan)) }}<span v-if="extras[loan.id]" class="extra-tag">+{{ fmt(extras[loan.id]!) }}</span></template><template v-else>—</template></b></div>
            <div>Payoff <b>
              <template v-if="loan.balance >= 0">{{ loan.endDate ? dateLabel(loan.endDate) : 'Paid' }} 🏆</template>
              <template v-else-if="loan.hidden">—</template>
              <template v-else-if="projections.get(loan.id)?.payoffMonth">{{ dateLabel(projections.get(loan.id)!.payoffMonth!) }}</template>
              <template v-else>never at this rate</template>
            </b></div>
            <div>Interest left <b>{{ loan.balance < 0 && !loan.hidden && projections.get(loan.id)?.payoffMonth ? fmt(projections.get(loan.id)!.interestTotal) : '—' }}</b></div>
          </div>
          <div class="lc-actions">
            <button class="lc-btn" @click="openEditor(loan)">✎ Edit</button>
            <button v-if="loan.balance < 0" class="lc-btn" @click="openRefi(loan)">⇄ Refinance</button>
            <button v-if="loan.source === 'manual' && !isMock" class="lc-btn danger" @click="removeRow(loan)">✕ Delete</button>
          </div>
        </article>
      </section>

      <section class="table-card">
        <table>
          <thead>
            <tr>
              <th class="check" />
              <th class="name">Debt</th>
              <th>Started</th>
              <th class="num col-wide">Original</th>
              <th class="num">Paid in</th>
              <th class="num">Balance</th>
              <th class="num teal-h">APR %</th>
              <th class="num teal-h">Monthly</th>
              <th>Payoff</th>
              <th class="num col-wide">Interest left</th>
              <th class="actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="loan in loans" :key="loan.id" :class="{ off: loan.hidden }">
              <td class="check">
                <input type="checkbox" :checked="!loan.hidden" :aria-label="`Include ${loan.name}`" @change="patchRow(loan, { hidden: !loan.hidden })">
              </td>
              <td class="name">
                <span class="chip" :style="{ background: loan.color }" />
                <span class="loan-name">{{ loan.name }}</span>
                <span class="plan-name">{{ loan.source === 'manual' ? 'manual' : loan.planName }}</span>
              </td>
              <td class="quiet">
                {{ loan.startDate ? dateLabel(loan.startDate) : '—' }}
                <span v-if="loan.hasOverride" class="override-mark" title="Adjusted by you — sync keeps it">*</span>
              </td>
              <td class="num col-wide">{{ fmt(-loan.startBalance) }}</td>
              <td class="num">
                {{ fmt(loan.paidIn) }}
                <span
                  v-if="reconcileState(loan) === 'error'"
                  class="recon-error"
                  :title="`Doesn't add up: original − paid in = ${fmt(reconcile(loan)!.expected)}, but balance is ${fmt(reconcile(loan)!.actual)} — edit this row to fix`"
                >⚠</span>
              </td>
              <td class="num strong">{{ loan.balance < 0 ? fmt(-loan.balance) : 'Paid ✓' }}</td>
              <td class="num quiet">{{ loan.balance < 0 && loan.rate ? `${loan.rate}%` : '—' }}</td>
              <td class="num quiet">
                <template v-if="loan.balance < 0">
                  {{ fmt(paymentFor(loan)) }}
                  <span v-if="extras[loan.id]" class="extra-tag" :title="`One-time extra next month — set in the edit panel`">+{{ fmt(extras[loan.id]!) }}</span>
                </template>
                <template v-else>—</template>
              </td>
              <td class="payoff">
                <template v-if="loan.balance >= 0">{{ loan.endDate ? dateLabel(loan.endDate) : 'Paid' }} 🏆</template>
                <template v-else-if="loan.hidden">—</template>
                <template v-else-if="projections.get(loan.id)?.payoffMonth">{{ dateLabel(projections.get(loan.id)!.payoffMonth!) }}</template>
                <template v-else>never at this rate</template>
              </td>
              <td class="num col-wide quiet">
                {{ loan.balance < 0 && !loan.hidden && projections.get(loan.id)?.payoffMonth ? fmt(projections.get(loan.id)!.interestTotal) : '—' }}
              </td>
              <td class="actions">
                <button class="icon-btn" title="Edit this debt's values" @click="openEditor(loan)">✎</button>
                <button v-if="loan.balance < 0" class="icon-btn refi-btn" title="Model a refinance" @click="openRefi(loan)">⇄</button>
                <button v-if="loan.source === 'manual' && !isMock" class="icon-btn del-btn" title="Delete this manual debt" @click="removeRow(loan)">✕</button>
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
      Synced rows refresh from YNAB when you hit Sync — your APR, Monthly, and
      start-date fixes survive. Manual rows chart a straight paydown between
      their two known points. "Extra next month" lives in each row's ✎ panel
      and is a one-time what-if that stays in this browser; the one-time
      payments and boosts above are saved with your strategy and shape every
      forecast on this page.
    </p>

    <PageFooter />

    <!-- Payoff order flyout -->
    <div v-if="orderModalOpen" class="flyout-backdrop" @click.self="orderModalOpen = false">
      <aside class="flyout" role="dialog" aria-modal="true" aria-label="Arrange payoff order">
        <header class="flyout-head">
          <h2>Payoff order</h2>
          <button class="reset" aria-label="Close" @click="orderModalOpen = false">✕</button>
        </header>
        <p class="muted">Top gets attacked first. Drag rows or use the arrows — payoff dates update live.</p>
        <ul class="order-list">
          <li
            v-for="(loan, index) in customLoansOrdered"
            :key="loan.id"
            draggable="true"
            :class="{ dragging: orderDragIdx === index }"
            @dragstart="orderDragIdx = index"
            @dragover.prevent
            @drop="onOrderDrop(index)"
            @dragend="orderDragIdx = null"
          >
            <span class="order-pos">{{ index + 1 }}</span>
            <span class="drag-grip" title="Drag to reorder">⠿</span>
            <span class="chip" :style="{ background: loan.color }" />
            <span class="order-name">{{ loan.name }}</span>
            <span class="order-balance">{{ fmt(-loan.balance) }}</span>
            <span class="order-payoff">
              {{ customResult.map.get(loan.id)?.payoffMonth ? dateLabel(customResult.map.get(loan.id)!.payoffMonth!) : '—' }}
            </span>
            <span class="order-btns">
              <button :disabled="index === 0" aria-label="Move up" @click="moveOrder(index, -1)">↑</button>
              <button :disabled="index === customLoansOrdered.length - 1" aria-label="Move down" @click="moveOrder(index, 1)">↓</button>
            </span>
          </li>
        </ul>
        <footer class="flyout-foot">
          <span class="muted">
            Debt-free {{ customResult.debtFree ? dateLabel(customResult.debtFree) : '—' }}
            · {{ fmt(customResult.interest) }} interest
          </span>
          <button class="primary" @click="orderModalOpen = false">Done</button>
        </footer>
      </aside>
    </div>

    <!-- Refinance / consolidation calculator flyout -->
    <div v-if="refi" class="flyout-backdrop" @click.self="refi = null">
      <aside class="flyout" role="dialog" aria-modal="true" aria-label="Refinance and consolidation calculator">
        <header class="flyout-head">
          <h2>Refinance / consolidate</h2>
          <button class="reset" aria-label="Close" @click="refi = null">✕</button>
        </header>
        <p class="muted">
          Bundle any set of debts into one new loan, then see the whole journey —
          your <strong>{{ strategyLabel.toLowerCase() }}</strong> plan{{ pooled ? ` with its ${fmt(snowballPool)} pool` : '' }} —
          with the bundle replaced by the new loan.
        </p>

        <ul class="bundle-list">
          <li v-for="loan in activeLoans" :key="loan.id">
            <label>
              <input
                type="checkbox"
                :checked="refi.bundleIds.includes(loan.id)"
                :aria-label="`Bundle ${loan.name}`"
                @change="toggleBundle(loan.id)"
              >
              <span class="chip" :style="{ background: loan.color }" />
              <span class="order-name">{{ loan.name }}</span>
              <span class="order-balance">{{ fmt(-loan.balance) }}</span>
              <span class="bundle-rate">{{ rateFor(loan) ? `${rateFor(loan)}%` : '—' }}</span>
            </label>
          </li>
        </ul>
        <p v-if="refiModel" class="muted bundle-sum">
          Bundling {{ refiModel.bundle.length }} {{ refiModel.bundle.length === 1 ? 'debt' : 'debts' }}
          · {{ fmt(refiModel.bundleBalance) }} balance
          · {{ fmt(refiModel.bundleMinimums) }}/mo in current minimums
          <button class="howto" @click="useBundleMinimums">use as new payment</button>
        </p>

        <div class="edit-fields">
          <div class="edit-grid">
            <label>
              New APR %
              <input v-model="refi.newRate" inputmode="decimal" aria-label="New APR percent">
            </label>
            <label>
              New monthly payment $
              <input v-model="refi.newPayment" inputmode="decimal" aria-label="New monthly payment">
            </label>
            <label>
              Origination fee $
              <input v-model="refi.fee" inputmode="decimal" aria-label="Origination fee">
            </label>
            <label>
              Cash out $ (optional)
              <input v-model="refi.cashOut" inputmode="decimal" aria-label="Cash out amount">
            </label>
          </div>
          <label class="edit-include">
            <input v-model="refi.feeRolled" type="checkbox" aria-label="Roll the fee into the new loan">
            Roll the fee into the new loan (it accrues interest too)
          </label>
        </div>

        <div v-if="refiModel" class="refi-compare">
          <div class="refi-col">
            <h3>Today's plan</h3>
            <p class="refi-big">{{ refiModel.currentJourney.debtFree ? dateLabel(refiModel.currentJourney.debtFree) : 'never at these payments' }}</p>
            <p class="muted">
              {{ fmt(refiModel.minsCurrent) }}/mo minimums
              · {{ refiModel.currentCost !== null ? `${fmt(refiModel.currentCost)} interest left` : 'interest keeps growing' }}
            </p>
          </div>
          <div class="refi-col">
            <h3>With the new loan</h3>
            <p class="refi-big">{{ refiModel.newJourney.debtFree ? dateLabel(refiModel.newJourney.debtFree) : 'never at these payments' }}</p>
            <p class="muted">
              {{ fmt(refiModel.principal) }} new principal
              · {{ fmt(refiModel.minsNew) }}/mo minimums
              · {{ refiModel.newCost !== null ? `${fmt(refiModel.newCost)} interest + fee` : 'doesn’t amortize' }}
            </p>
          </div>
        </div>

        <p v-if="refiModel" class="payoff-strip" :class="{ warn: refiModel.savings !== null && refiModel.savings < 0 }">
          <template v-if="refiModel.savings === null && !refiModel.currentJourney.debtFree && refiModel.newJourney.debtFree">
            Today's payments never clear everything — consolidating makes the whole
            journey finish, debt-free {{ dateLabel(refiModel.newJourney.debtFree) }}.
          </template>
          <template v-else-if="refiModel.savings === null">
            One side never amortizes — raise its payment to compare.
          </template>
          <template v-else-if="refiModel.savings >= 0">
            This consolidation saves <strong>{{ fmt(refiModel.savings) }}</strong> all-in<template v-if="refiModel.monthsSooner && refiModel.monthsSooner > 0"> and the whole journey finishes {{ refiModel.monthsSooner }} months sooner</template>.
          </template>
          <template v-else>
            This consolidation costs <strong>{{ fmt(-refiModel.savings) }}</strong> more all-in<template v-if="refiModel.monthsSooner && refiModel.monthsSooner < 0"> and takes {{ -refiModel.monthsSooner }} months longer</template> — the fee
            and terms don't beat what you have.
          </template>
          <template v-if="refiModel.minsNew < refiModel.minsCurrent">
            Required monthlies drop {{ fmt(refiModel.minsCurrent - refiModel.minsNew) }}/mo.
          </template>
          <template v-if="refiModel.cashOut > 0">
            (Cash-out of {{ fmt(refiModel.cashOut) }} excluded from the savings math.)
          </template>
        </p>

        <footer class="flyout-foot">
          <span class="muted">A what-if only — nothing is saved.</span>
          <button class="primary" @click="refi = null">Done</button>
        </footer>
      </aside>
    </div>

    <!-- One-time payment editor flyout -->
    <div v-if="lumpEdit" class="flyout-backdrop" @click.self="lumpEdit = null">
      <aside class="flyout" role="dialog" aria-modal="true" aria-label="One-time payment">
        <header class="flyout-head">
          <h2>{{ lumpEdit.id ? 'Edit payment' : 'Add a payment' }}</h2>
          <button class="reset" aria-label="Close" @click="lumpEdit = null">✕</button>
        </header>
        <p class="muted">
          Money on top of the monthly plan — a lump that lands on a date (once
          or on a rhythm), or a boost that adds a bit every month for a while.
          Add as many as you like; they stack.
        </p>

        <div class="kind-grid" role="radiogroup" aria-label="Kind of payment">
          <button
            v-for="kind in LUMP_KINDS"
            :key="kind"
            type="button"
            class="kind-btn"
            :class="{ on: lumpEdit.kind === kind }"
            role="radio"
            :aria-checked="lumpEdit.kind === kind"
            :title="LUMP_META[kind].blurb"
            @click="setLumpKind(kind)"
          >
            <span aria-hidden="true">{{ LUMP_META[kind].icon }}</span> {{ LUMP_META[kind].label }}
          </button>
        </div>

        <div class="edit-fields">
          <div class="edit-grid">
            <label>
              Label
              <input v-model="lumpEdit.label" :placeholder="LUMP_META[lumpEdit.kind].hint" aria-label="Label" maxlength="60">
            </label>
            <label>
              {{ lumpEdit.kind === 'boost' ? 'Extra per month $' : 'Amount $' }}
              <input v-model="lumpEdit.amount" inputmode="decimal" placeholder="0" aria-label="Amount">
            </label>
            <template v-if="lumpEdit.kind === 'boost'">
              <label>
                Starts
                <input v-model="lumpEdit.month" type="month" aria-label="First month">
              </label>
              <label>
                For … months
                <input v-model="lumpEdit.times" inputmode="numeric" placeholder="until debt-free" aria-label="How many months">
              </label>
            </template>
            <template v-else>
              <label>
                {{ lumpEdit.repeat === 'every' ? 'First payment' : 'Month' }}
                <input v-model="lumpEdit.month" type="month" aria-label="Month">
              </label>
              <label>
                Repeats
                <select v-model="lumpEdit.repeat" aria-label="Repeats">
                  <option value="once">Just once</option>
                  <option value="every">On a rhythm</option>
                </select>
              </label>
              <template v-if="lumpEdit.repeat === 'every'">
                <label>
                  Every … months
                  <input v-model="lumpEdit.every" inputmode="numeric" placeholder="12" aria-label="Months between payments">
                </label>
                <label>
                  How many times
                  <input v-model="lumpEdit.times" inputmode="numeric" placeholder="until debt-free" aria-label="Number of payments">
                </label>
              </template>
            </template>
            <label class="edit-span">
              Goes to
              <select v-model="lumpEdit.loanId" aria-label="Which loan">
                <option value="">Follow the strategy — {{ settings.strategy === 'minimum' ? 'highest APR first' : 'next loan in line' }}</option>
                <option v-for="loan in activeLoans" :key="loan.id" :value="loan.id">{{ loan.name }} · {{ fmt(-loan.balance) }}</option>
              </select>
            </label>
          </div>
        </div>

        <p v-if="lumpDraftEffect" class="recon-line" :class="lumpDraftEffect.monthsSooner || lumpDraftEffect.withDraft.debtFree ? 'ok' : 'info'">
          <template v-if="!lumpDraftEffect.hits">
            That month is already behind us — nothing left to forecast.
          </template>
          <template v-else-if="lumpDraftEffect.monthsSooner !== null">
            {{ fmt(lumpDraftEffect.total) }} across {{ lumpDraftEffect.hits }} {{ lumpDraftEffect.hits === 1 ? 'payment' : 'payments' }}
            moves debt-free from {{ dateLabel(lumpDraftEffect.without.debtFree!) }}
            to <strong>{{ dateLabel(lumpDraftEffect.withDraft.debtFree!) }}</strong>
            — {{ monthsSooner(lumpDraftEffect.monthsSooner) }}<template v-if="lumpDraftEffect.interestSaved">,
              {{ fmt(Math.abs(lumpDraftEffect.interestSaved)) }} {{ lumpDraftEffect.interestSaved > 0 ? 'less' : 'more' }} interest</template>.
          </template>
          <template v-else-if="lumpDraftEffect.withDraft.debtFree">
            This is what gets the plan to debt-free at all —
            <strong>{{ dateLabel(lumpDraftEffect.withDraft.debtFree) }}</strong>, {{ fmt(lumpDraftEffect.withDraft.interest) }} interest.
          </template>
          <template v-else>
            Even with this, some loans never amortize at their current payments.
          </template>
        </p>
        <p v-else-if="lumpEdit.amount" class="muted">Enter an amount and a month to see the effect.</p>

        <footer class="flyout-foot">
          <button v-if="lumpEdit.id" class="ghost-btn danger" @click="deleteLump">Remove</button>
          <span v-else class="muted">Saved with your strategy settings.</span>
          <button class="primary" :disabled="!lumpDraft" @click="saveLump">{{ lumpEdit.id ? 'Save' : 'Add' }}</button>
        </footer>
      </aside>
    </div>

    <!-- Row editor flyout -->
    <div v-if="editing" class="flyout-backdrop" @click.self="editing = null">
      <aside class="flyout" role="dialog" aria-modal="true" aria-label="Edit debt details">
        <header class="flyout-head">
          <h2>Edit {{ editing.name }}</h2>
          <button class="reset" aria-label="Close" @click="editing = null">✕</button>
        </header>
        <p v-if="editing.isManual" class="muted">
          Manual debt — everything is yours to shape. Changing amounts or dates
          redraws its paydown on the chart.
        </p>
        <p v-else class="muted">
          Synced from <strong>{{ editing.planName }}</strong> — history refreshes
          on sync, but everything you set here (name, balance, paid-in, start,
          APR, monthly) is an override that survives every sync.
        </p>
        <div class="edit-fields">
          <label>
            Name
            <input v-model="editing.name" aria-label="Debt name">
          </label>
          <div class="edit-grid">
            <label>
              {{ editing.isManual ? 'Original amount $' : 'True original amount $' }}
              <input v-model="editing.original" inputmode="decimal" aria-label="Original amount">
            </label>
            <label>
              Balance now $ (0 = paid)
              <input v-model="editing.balance" inputmode="decimal" aria-label="Current balance">
            </label>
            <label>
              Paid in $
              <input v-model="editing.paidIn" inputmode="decimal" aria-label="Paid in total">
            </label>
            <label>
              {{ editing.isManual ? 'Started' : 'Loan actually started' }}
              <input v-model="editing.startMonth" type="month" aria-label="Start month">
            </label>
            <label v-if="editing.isManual">
              Paid off (optional)
              <input v-model="editing.endMonth" type="month" aria-label="Paid off month">
            </label>
            <label>
              APR %
              <input v-model="editing.rate" inputmode="decimal" aria-label="APR percent" :disabled="editing.isPaid">
            </label>
            <label>
              Monthly payment $
              <input v-model="editing.payment" inputmode="decimal" aria-label="Monthly payment" :disabled="editing.isPaid">
            </label>
            <label v-if="!editing.isPaid">
              Extra next month $
              <input
                v-model="editing.extraNext" inputmode="decimal" placeholder="0"
                aria-label="One-time extra payment next month"
                title="One-time what-if on top of the monthly — stays in this browser"
              >
            </label>
          </div>
          <label class="edit-include">
            <input v-model="editing.included" type="checkbox" aria-label="Include on the chart">
            Include on the chart and in the math
          </label>
          <p v-if="editorReconcile" class="recon-line" :class="editorReconcile.tone">
            {{ editorReconcile.text }}
          </p>
        </div>
        <footer class="flyout-foot">
          <button v-if="editing.hasOverride && !editing.isManual" class="ghost-btn" @click="clearEditorOverride">Reset overrides to synced</button>
          <button class="primary" @click="saveEditor">Save</button>
        </footer>
      </aside>
    </div>

    <!-- Import modal -->
    <div v-if="importOpen" class="overlay" @click="importOpen = false">
      <div class="modal" role="dialog" aria-label="Import debts from JSON" @click.stop>
        <div class="modal-head">
          <div class="modal-title">Import debts from JSON</div>
          <button class="x" aria-label="Close" @click="importOpen = false">✕</button>
        </div>
        <p class="modal-copy">
          Paste (or pick a file with) the shape <b>Export JSON</b> writes:
          <code>{ "debts": [ … ] }</code>. Amounts are plain currency
          (<code>19591.20</code>, not milliunits) and always positive; months are
          <code>YYYY-MM</code>. Every row becomes a <b>hand-tracked</b> debt — a
          row whose name matches one you already track by hand <b>updates it</b>
          instead of adding a duplicate. Synced YNAB rows are never changed.
        </p>
        <table class="fields">
          <tbody>
            <tr><td><code>name</code></td><td>required</td></tr>
            <tr><td><code>startBalance</code></td><td>required — the original amount borrowed</td></tr>
            <tr><td><code>startDate</code></td><td>required — month the loan began</td></tr>
            <tr><td><code>balance</code></td><td>what's left today (0 = paid off)</td></tr>
            <tr><td><code>endDate</code></td><td>month it was paid off, if it was</td></tr>
            <tr><td><code>rate</code>, <code>minimumPayment</code></td><td>APR % and monthly payment</td></tr>
            <tr><td><code>paidIn</code></td><td>total paid so far (defaults to startBalance − balance)</td></tr>
            <tr><td><code>history</code></td><td>optional <code>[{ "month", "balance" }]</code> — real month-by-month balances; without it the chart draws a straight paydown</td></tr>
          </tbody>
        </table>
        <pre class="example">{
  "debts": [
    { "name": "🚐 RV loan", "startDate": "2024-06",
      "startBalance": 19591, "balance": 14200,
      "rate": 7.9, "minimumPayment": 385 },
    { "name": "🚗 The Honda", "startDate": "2021-03",
      "endDate": "2025-04", "startBalance": 19000, "balance": 0 }
  ]
}</pre>
        <textarea v-model="importText" rows="6" class="paste" placeholder="Paste your JSON here…" />
        <div class="import-row">
          <button class="y-btn-dashed" @click="pickImportFile">…or choose a .json file</button>
          <span class="import-status" :class="{ bad: parsedImport.error || importMessage, good: canImport && !importMessage }">{{ importMessage || importStatus }}</span>
        </div>
        <div class="modal-actions">
          <button class="y-btn-secondary" @click="importOpen = false">Cancel</button>
          <button class="y-btn" :disabled="!canImport" @click="doImport">
            <template v-if="importing">Importing…</template>
            <template v-else-if="canImport">Import {{ parsedImport.debts!.length }} debt{{ parsedImport.debts!.length === 1 ? '' : 's' }}</template>
            <template v-else>Import</template>
          </button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  min-width: 0;
  padding: 26px 32px 60px;
  max-width: 1060px;
  line-height: 1.45;
}

/* ---- Header ---- */
.top { display: block; }
.title-row { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.title-row h1 { font-size: 26px; }
.story-link { font-weight: 800; font-size: 13.5px; }

.badge {
  padding: 3px 10px;
  border-radius: var(--r-pill);
  background: var(--note-bg);
  border: 1.5px solid var(--note-border);
  color: var(--warn);
  font-size: 11.5px;
  font-weight: 800;
}

.tagline {
  margin: 8px 0 0;
  font-size: 13.5px;
  color: var(--fg-muted);
  max-width: 640px;
}

/* ---- Sync row ---- */
.sync-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 14px;
}

.picker-label {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: var(--fg-subtle);
}

.top-actions { margin-left: auto; display: flex; gap: 8px; align-self: center; }

.primary {
  padding: 7px 16px;
  border: none;
  border-radius: var(--r-sm);
  background: var(--teal);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
}
.primary:hover:not(:disabled) { background: var(--teal-dark); }
.primary:disabled { opacity: 0.55; cursor: not-allowed; }

.ghost-btn {
  padding: 7px 14px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-sm);
  background: var(--bg-card);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--fg-muted);
  cursor: pointer;
}
.ghost-btn:hover { border-color: var(--teal); color: var(--teal-dark); }

.sync-msg { font-size: 12px; color: var(--ok); font-weight: 700; }
.muted { color: var(--fg-subtle); font-size: 12px; }

/* ---- Empty / loading ---- */
.status {
  margin: 24px 0;
  padding: 16px 20px;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-card);
  font-size: 13.5px;
}
.status h2 { font-size: 16px; margin: 0 0 6px; }
.status p { margin: 6px 0 0; color: var(--fg-muted); }

/* ---- Stat cards ---- */
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin: 16px 0;
}

.stats article {
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: 12px;
}

.stats h3 {
  margin: 0;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: var(--fg-subtle);
}

.stats p { margin: 4px 0 0; font-size: 21px; font-weight: 800; font-variant-numeric: tabular-nums; }
.stats .sub { font-size: 11.5px; font-weight: 400; color: var(--fg-faint); margin-top: 0; }
.stats .sub.borrowed { margin-top: 2px; font-weight: 700; color: var(--fg-subtle); }

/* Paid down reads green; the Debt-free card is the teal celebration */
.stats article:nth-child(2) p:not(.sub) { color: var(--ok); }
.stats article:nth-child(4) {
  background: var(--teal-badge);
  border-color: #a8dcd6;
}
.stats article:nth-child(4) h3 { color: var(--teal-dark); }
.stats article:nth-child(4) p { color: var(--teal-dark); }
.stats article:nth-child(4) .sub { color: var(--teal); }
.stats .negative p:not(.sub) { color: var(--danger); }

/* ---- Strategy cards ---- */
.strategies {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin: 16px 0 0;
}

.strategy-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 11px 13px;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  background: var(--bg-card);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.strategy-card.on { border: 2px solid var(--teal); background: var(--teal-bg); padding: 10.5px 12.5px; }

.strat-name { font-weight: 800; font-size: 13.5px; }
.strat-blurb { font-size: 11.5px; color: var(--fg-subtle); line-height: 1.4; }
.strat-result { font-size: 12px; font-weight: 700; color: #4a463c; font-variant-numeric: tabular-nums; }
.strategy-card.on .strat-result { color: var(--teal-dark); }

/* ---- Snowball / extra row ---- */
.strategy-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  margin: 10px 0 0;
}

.pool-field {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--fg-muted);
}

.pool-field input {
  width: 80px;
  padding: 6px 9px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-xs);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  text-align: right;
  background: var(--bg-input);
  font-variant-numeric: tabular-nums;
}
.pool-field input:focus { border-color: var(--teal); outline: none; }

/* ---- One-time payments row ---- */
.lumps-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: center;
  margin: 10px 0 0;
}

.lumps-label { font-size: 12.5px; font-weight: 700; color: var(--fg-muted); }

.lump-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 5px 11px;
  border: 1.5px solid var(--teal);
  border-radius: var(--r-pill);
  background: var(--teal-bg);
  color: var(--teal-dark);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  max-width: 100%;
}
.lump-chip strong { font-weight: 800; white-space: nowrap; }
.lump-chip span { color: var(--fg-muted); font-variant-numeric: tabular-nums; }
.lump-chip .lump-icon { color: inherit; font-size: 12px; }
.lump-chip em {
  font-style: normal;
  font-weight: 800;
  font-size: 11px;
  white-space: nowrap;
  padding-left: 6px;
  border-left: 1.5px solid var(--teal);
}
.lump-chip.past em { display: none; }

.kind-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 4px; }
.kind-btn {
  padding: 7px 8px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-sm);
  background: var(--bg-card);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  color: var(--fg-muted);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kind-btn:hover { border-color: var(--teal); color: var(--teal-dark); }
.kind-btn.on { border-color: var(--teal); background: var(--teal-bg); color: var(--teal-dark); }

.boost-span line { stroke: var(--teal-dark); stroke-width: 2; opacity: 0.7; }
.chip.boost { background: var(--teal-dark); height: 3px; border-radius: 2px; opacity: 0.7; }
.lump-chip:hover { background: var(--teal-badge); }
.lump-chip.past { border-style: dashed; border-color: var(--border-input); background: var(--bg-card); color: var(--fg-subtle); }
.lump-chip.past span { color: var(--fg-subtle); }

.lumps-effect { font-size: 12.5px; color: var(--fg-muted); }
.lumps-effect strong { color: var(--teal-dark); }

.lump-mark line { stroke: var(--teal-dark); stroke-width: 1.5; }
.lump-mark path { fill: var(--teal-dark); }

.chip.lump { background: var(--teal-dark); border-radius: 2px; clip-path: polygon(0 0, 100% 0, 50% 100%); }

.tip-lump { color: var(--teal-dark); font-weight: 700; }

.ghost-btn.danger:hover { border-color: var(--danger); color: var(--danger-dark); }
.ghost-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.edit-fields select {
  padding: 7px 10px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-xs);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  background: var(--bg-input);
  color: inherit;
  text-transform: none;
  letter-spacing: normal;
  max-width: 100%;
}
.edit-fields select:focus { border-color: var(--teal); outline: none; }
.edit-span { grid-column: 1 / -1; }

/* ---- Chart card ---- */
.chart-card {
  position: relative;
  margin-top: 14px;
  padding: 18px 20px;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-card);
}

.burndown { width: 100%; height: auto; display: block; }

.grid { stroke: var(--border-soft); stroke-width: 1; }
.tick { fill: var(--fg-subtle); font-size: 11px; font-variant-numeric: tabular-nums; }

.band.past { opacity: 0.85; stroke: #fff; stroke-width: 2; }
.band.future { opacity: 0.28; stroke: #fff; stroke-width: 2; }

.track { fill: none; stroke: var(--teal); stroke-width: 2; stroke-dasharray: 6 5; }
.today-line { stroke: var(--teal-border); stroke-width: 1; stroke-dasharray: 2 3; }
.today-dot { fill: #fff; stroke: var(--teal); stroke-width: 2.5; }
.crosshair { stroke: var(--fg-subtle); stroke-width: 1; }

.tooltip {
  position: absolute;
  top: 20px;
  padding: 9px 12px;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(43, 42, 38, 0.14);
  font-size: 11.5px;
  pointer-events: none;
  min-width: 210px;
  z-index: 5;
}

.tip-title { margin: 0 0 4px; font-weight: 800; font-size: 12px; }
.tip-phase { color: var(--fg-faint); font-weight: 600; margin-left: 4px; }
.tip-row { margin: 3px 0 0; display: flex; align-items: center; gap: 7px; }
.tip-name { flex: 1; color: var(--fg-muted); }
.tip-value { font-weight: 800; font-variant-numeric: tabular-nums; }
.tip-total { border-top: 1px solid var(--border-soft); margin-top: 5px; padding-top: 4px; }

.chip { display: inline-block; width: 10px; height: 10px; border-radius: 3px; flex: none; }

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--fg-muted);
}
.legend-item { display: inline-flex; align-items: center; gap: 6px; }
.legend-item.muted { color: var(--fg-faint); }
.chip.solid { width: 14px; height: 9px; border-radius: 2px; background: #8b8577; opacity: 0.8; }
.chip.dashed { width: 14px; height: 9px; border-radius: 2px; background: #8b8577; opacity: 0.3; border: none; }

.payoff-strip {
  margin: 10px 0 0;
  padding: 10px 14px;
  background: var(--teal-bg);
  border: 1px solid var(--teal-border);
  border-radius: 9px;
  font-size: 13px;
  color: #3c4a46;
}
.payoff-strip.warn { background: var(--note-bg); border-color: var(--note-border); color: var(--warn); }

/* ---- Accounts table — text only, no horizontal scroll ---- */
.table-card {
  margin-top: 16px;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-card);
  overflow: hidden;
}

table { width: 100%; border-collapse: collapse; font-size: 12.5px; table-layout: auto; }

thead th {
  text-align: left;
  font-size: 10.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--fg-subtle);
  border-bottom: 1.5px solid var(--border-soft);
  padding: 10px 8px;
  white-space: nowrap;
}
thead th:first-child { padding-left: 16px; }
thead th:last-child { padding-right: 16px; }
thead th.teal-h { color: var(--teal-dark); }

td { padding: 9px 8px; border-bottom: 1px solid var(--border-hair); vertical-align: middle; }
td:first-child { padding-left: 16px; }
td:last-child { padding-right: 16px; }
tbody tr:last-child td { border-bottom: none; }

th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.strong { font-weight: 800; font-size: 13px; }
td.quiet { color: var(--fg-muted); font-size: 12px; white-space: nowrap; }

td.check input { width: 15px; height: 15px; accent-color: var(--teal); display: block; }

td.name { max-width: 0; width: 32%; }
td.name .chip { margin-right: 8px; vertical-align: -1px; }
.loan-name { font-weight: 700; font-size: 13.5px; }
td.name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.plan-name { margin-left: 7px; font-size: 10.5px; color: var(--fg-faint); }

.override-mark { color: var(--teal); font-weight: 800; }
.recon-error { color: var(--danger); cursor: help; margin-left: 2px; }
.extra-tag {
  margin-left: 5px;
  font-size: 10.5px;
  font-weight: 800;
  color: var(--teal-dark);
  background: var(--teal-badge);
  border-radius: var(--r-pill);
  padding: 1px 7px;
}

td.payoff { font-size: 12px; font-weight: 700; color: #4a463c; white-space: nowrap; }

tr.off td { opacity: 0.5; }
tr.off .loan-name { text-decoration: line-through; }

td.actions { white-space: nowrap; text-align: right; }
.icon-btn {
  border: none;
  background: none;
  cursor: pointer;
  color: var(--teal);
  font-size: 13px;
  padding: 2px 3px;
}
.icon-btn:hover { color: var(--teal-dark); }
.refi-btn { color: var(--fg-subtle); }
.refi-btn:hover { color: var(--teal-dark); }
.del-btn { color: var(--fg-faint); }
.del-btn:hover { color: var(--danger); }

/* ---- Add a debt by hand ---- */
.manage {
  margin-top: 16px;
  padding: 18px 20px;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-card);
}
.manage h2 { margin: 0; font-size: 15px; font-weight: 800; }
.manage .muted { display: block; margin-top: 6px; font-size: 12.5px; }

.add-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 12px;
}

.add-form input {
  padding: 8px 11px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-sm);
  font: inherit;
  font-size: 13px;
  background: var(--bg-input);
}
.add-form input:focus { border-color: var(--teal); outline: none; }
.add-form input:first-child { flex: 2 1 170px; }

.footnote { color: var(--fg-faint); font-size: 11.5px; line-height: 1.5; margin-top: 14px; }

/* ---- Side panels (edit / refinance / payoff order) ---- */
.flyout-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(43, 42, 38, 0.45);
  /* Above the Feedback FAB (40), level with the import modal — a panel's
     footer buttons sit exactly where the FAB lives. */
  z-index: 50;
  display: flex;
  justify-content: flex-end;
}

.flyout {
  width: min(480px, 100%);
  height: 100vh;
  height: 100dvh;
  background: var(--bg-card);
  border-left: 1.5px solid var(--border);
  box-shadow: -12px 0 32px rgba(43, 42, 38, 0.18);
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.flyout-head { display: flex; align-items: baseline; justify-content: space-between; }
.flyout-head h2 { margin: 0; font-size: 17px; font-weight: 800; }
.flyout .muted { font-size: 12.5px; line-height: 1.5; }

.reset { border: none; background: none; cursor: pointer; color: var(--fg-subtle); font-size: 16px; font-weight: 800; padding: 0; }
.reset:hover { color: var(--fg); }

/* order rows — warm cards with position numbers */
.order-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.order-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  background: var(--bg-app);
  border: 1px solid var(--border-soft);
  border-radius: 9px;
}
.order-list li.dragging { opacity: 0.5; border-style: dashed; }

.order-pos { width: 18px; font-weight: 800; font-size: 12px; color: var(--fg-subtle); flex: none; }
.drag-grip { color: #c9c2b2; cursor: grab; user-select: none; }
.order-name { flex: 1; min-width: 0; font-weight: 700; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.order-balance { font-size: 12.5px; color: var(--fg-muted); font-variant-numeric: tabular-nums; }
.order-payoff { font-size: 12px; font-weight: 700; color: var(--teal-dark); min-width: 66px; text-align: right; font-variant-numeric: tabular-nums; }

.order-btns { display: inline-flex; gap: 4px; }
.order-btns button {
  border: 1px solid var(--border-input);
  background: var(--bg-card);
  border-radius: 6px;
  width: 24px;
  height: 24px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.order-btns button:disabled { opacity: 0.35; cursor: not-allowed; }

.flyout-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 14px;
  border-top: 1.5px solid var(--border-soft);
}

/* field groups — design's uppercase micro-labels */
.edit-fields { display: flex; flex-direction: column; gap: 12px; margin-top: 6px; }

.edit-fields label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--fg-subtle);
}

.edit-fields input {
  padding: 7px 10px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-xs);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  background: var(--bg-input);
  text-transform: none;
  letter-spacing: normal;
}
.edit-fields input:focus { border-color: var(--teal); outline: none; }
.edit-fields input:disabled { background: var(--bg-app); border-color: var(--border-soft); color: var(--fg-subtle); }

.edit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.edit-include {
  flex-direction: row !important;
  align-items: center;
  gap: 8px !important;
  font-size: 12.5px !important;
  font-weight: 700 !important;
  text-transform: none !important;
  letter-spacing: normal !important;
  color: var(--fg-muted) !important;
  cursor: pointer;
}
.edit-include input { width: 15px; height: 15px; accent-color: var(--teal); }

.recon-line { margin: 0; padding: 9px 12px; border-radius: var(--r-xs); font-size: 12.5px; line-height: 1.5; }
.recon-line.ok { background: var(--ok-bg); color: var(--ok); }
.recon-line.info { background: var(--teal-bg); color: #3c4a46; }
.recon-line.error { background: var(--danger-bg); color: var(--danger-dark); }

/* refinance compare — plan card vs teal "with the new loan" card */
.refi-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 6px; }

.refi-col { padding: 12px 14px; border-radius: 10px; background: var(--bg-app); border: 1.5px solid var(--border-soft); }
.refi-col:last-child { background: var(--teal-badge); border-color: #a8dcd6; }

.refi-col h3 {
  margin: 0;
  font-size: 10.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--fg-subtle);
}
.refi-col:last-child h3 { color: var(--teal-dark); }

.refi-big { margin: 4px 0 0; font-size: 17px; font-weight: 800; }
.refi-col:last-child .refi-big { color: var(--teal-dark); }
.refi-col .muted { font-size: 12px; margin-top: 2px; }
.refi-col:last-child .muted { color: var(--teal); }

/* bundle checklist — warm rows */
.bundle-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bundle-list label {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  background: var(--bg-app);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.bundle-list input { width: 15px; height: 15px; accent-color: var(--teal); flex: none; }
.bundle-list .order-name { font-size: 13px; }
.bundle-rate { min-width: 52px; text-align: right; color: var(--fg-faint); font-size: 12px; }
.bundle-sum { margin: 2px 0; }
.bundle-sum .howto { margin-left: 4px; }

.howto {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  color: var(--teal);
  cursor: pointer;
}
.howto:hover { color: var(--teal-dark); }

/* ---- No horizontal scroll: shed the wide columns first ---- */
/* ---- Import modal ---- */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(43, 42, 38, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.modal {
  width: 600px;
  max-width: 100%;
  max-height: 86vh;
  overflow: auto;
  background: var(--bg-card);
  border-radius: var(--r-panel);
  padding: 24px;
  box-shadow: 0 12px 40px rgba(43, 42, 38, 0.3);
}
.modal-head { display: flex; align-items: baseline; gap: 10px; }
.modal-title { font-weight: 800; font-size: 17px; }
.x { margin-left: auto; border: none; background: none; color: var(--fg-subtle); font-size: 16px; font-weight: 800; cursor: pointer; padding: 0; }
.modal-copy { margin: 8px 0 0; font-size: 13px; color: var(--fg-muted); line-height: 1.55; }
.modal-copy code, .fields code { background: var(--bg-app); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.fields { margin: 10px 0 0; border-collapse: collapse; font-size: 12.5px; color: var(--fg-muted); width: 100%; }
.fields td { padding: 3px 0; vertical-align: top; }
.fields td:first-child { white-space: nowrap; padding-right: 12px; }
.example {
  margin: 12px 0 0;
  background: var(--fg);
  color: var(--nav-fg);
  border-radius: 10px;
  padding: 14px 16px;
  font-size: 12px;
  line-height: 1.6;
  overflow: auto;
}
.paste {
  margin-top: 12px;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-field);
  font-size: 12.5px;
  font-family: ui-monospace, Menlo, monospace;
  background: var(--bg-input);
  resize: vertical;
  line-height: 1.5;
}
.paste:focus { border-color: var(--teal); outline: none; }
.import-row { margin-top: 8px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.import-status { font-size: 12px; font-weight: 700; color: var(--fg-faint); }
.import-status.good { color: var(--ok); }
.import-status.bad { color: var(--danger); }
.modal-actions { margin-top: 16px; display: flex; gap: 10px; }

@media (max-width: 1200px) {
  th.col-wide, td.col-wide { display: none; }
}

@media (max-width: 980px) {
  .stats, .strategies { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 860px) {
  .page { padding: 28px 20px 60px; }
  .plan-name { display: none; }
  td.quiet, td.payoff { font-size: 11px; }
}

/* ---- Tablet: sidebar is an icon rail, keep the table breathing ---- */
@media (max-width: 1099px) {
  thead th, td { padding-left: 6px; padding-right: 6px; }
  .flyout { width: min(440px, 100%); }
}

/* ---- Phone loan cards (the table is replaced under 760px) ---- */
.loan-cards { display: none; margin-top: 16px; flex-direction: column; gap: 10px; }
.loan-card {
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-card);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.loan-card.off { opacity: 0.55; }
.lc-head { display: flex; align-items: center; gap: 10px; }
.lc-check { width: 22px; height: 22px; accent-color: var(--teal); flex: none; margin: 0; }
.lc-who { flex: 1; min-width: 0; }
.lc-name { font-size: 15px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lc-plan { font-size: 11px; color: var(--fg-faint); }
.lc-balance { font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; flex: none; }
.lc-balance.paid { color: var(--ok); }
.lc-bar { height: 6px; border-radius: 999px; background: var(--neutral-bg); overflow: hidden; }
.lc-fill { height: 100%; border-radius: 999px; }
.lc-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px 8px;
  font-size: 11.5px;
  color: var(--fg-muted);
}
.lc-grid b { display: block; color: var(--fg); font-variant-numeric: tabular-nums; }
.lc-grid b.teal { color: var(--teal-dark); }
.lc-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.lc-btn {
  min-height: 40px;
  padding: 0 14px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-xs);
  background: var(--bg-card);
  color: var(--teal-dark);
  font: inherit;
  font-size: 12.5px;
  font-weight: 800;
  cursor: pointer;
}
.lc-btn.danger { color: var(--danger); margin-left: auto; }

@media (max-width: 759px) {
  .loan-cards { display: flex; }
  .table-card { display: none; }
  .page { padding: 16px 16px 40px; max-width: none; }
  .title-row { gap: 8px 12px; }
  .title-row h1 { font-size: 22px; }
  .top-actions { margin-left: 0; width: 100%; }
  .top-actions > * { flex: 1; }
  .sync-bar { gap: 8px 10px; }
  .sync-bar .primary { min-height: 44px; }
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .stats article { padding: 12px 12px; }
  .stats p { font-size: 19px; }
  /* strategies: one snap-scrolling row */
  .strategies {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scroll-snap-type: x mandatory;
    scroll-padding: 0 16px;
    margin: 14px -16px 0;
    padding: 2px 16px 6px;
  }
  .strategy-card { flex: 0 0 156px; scroll-snap-align: start; min-height: 44px; }
  .strategy-bar { gap: 10px 14px; }
  .pool-field input { min-height: 40px; }
  .chart-card { padding: 12px 10px 14px; }
  .tooltip { min-width: 0; max-width: 60%; font-size: 11px; }
  .payoff-strip { font-size: 12.5px; }
  .manage .add-form input { min-height: 44px; }
  /* side panels become bottom sheets */
  .flyout-backdrop { align-items: flex-end; justify-content: stretch; }
  .flyout {
    width: 100%;
    height: auto;
    max-height: 92vh;
    max-height: 92dvh;
    border-left: none;
    border-top: 1.5px solid var(--border);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -8px 28px rgba(43, 42, 38, 0.2);
    padding: 14px 16px calc(18px + env(safe-area-inset-bottom));
    -webkit-overflow-scrolling: touch;
  }
  .flyout-head { position: sticky; top: -14px; background: var(--bg-card); padding: 4px 0 6px; z-index: 1; }
  .reset { width: 44px; height: 44px; margin: -10px -12px -10px 0; display: grid; place-items: center; }
  .overlay { padding: 12px; align-items: flex-end; }
  .modal { padding: 16px; max-height: 92vh; max-height: 92dvh; border-radius: 16px; }
}
</style>
