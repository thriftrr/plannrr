<script setup lang="ts">
useHead({ title: 'Calendrr' })
import type { BudgetAccount, BudgetTransaction, Category, MonthDetail, MonthSummary, ScheduledTransaction } from '#shared/types/ynab'
import { accountKind } from '#shared/types/ynab'
import type { CustomMonthly, DetectedSeries, RecurringPrefs } from '#shared/types/recurring'
import { emptyAccountPrefs } from '#shared/types/recurring'
import type { CashRow } from '~/components/CashPicker.vue'

// Calendrr — bills, expected income, and goal target dates on a month grid,
// with a cash-flow twist: past days chart what actually happened (the
// register), today-and-forward chart detected recurring series, scheduled
// transactions, and hand-added monthlies — and every day carries its morning
// balance, so a bill on the 1st reads as money gone on the morning of the 2nd.

const { plans, selectedIds, selectedPlans, label, load, toggle } = usePlanSelection()
const { format } = useMoney()

type DayEvent = {
  kind: 'bill' | 'income' | 'goal'
  planned: boolean          // recurring / scheduled / hand-added / goal — earns a chip
  projected: boolean        // expected, vs. actually on the register
  label: string             // Tinkrr's row (the category) — never the vendor
  payee: string             // vendors survive only in tooltips
  amountLabel: string
  amountMilli: number
  detail: string
  day: number
}

const monthsByPlan = ref<Record<string, MonthSummary[]>>({})
const schedByPlan = ref<Record<string, ScheduledTransaction[]>>({})
type TxnBundle = { transactions: BudgetTransaction[], balance_now: number | null, accounts: BudgetAccount[], accounts_at: string | null }
const txnsByPlan = ref<Record<string, TxnBundle>>({})
const prefsByPlan = ref<Record<string, RecurringPrefs>>({})
const kindByPlan = ref<Record<string, string>>({})
const detailCache = new Map<string, MonthDetail | null>()
const details = ref<Record<string, MonthDetail | null>>({})
const debts = ref<Array<{ name: string, balance: number }>>([])

const month = ref('')
const selectedDay = ref<number | null>(null)
const loading = ref(true)
const noPlans = ref(false)
const connectError = ref(false)
const saveNote = ref('')

const currency = computed(() => selectedPlans.value[0]?.currency_format?.iso_code ?? null)
const fmt = (milliunits: number) => format(milliunits, currency.value)

const today = new Date()
const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
const todayIso = `${todayKey}-${String(today.getDate()).padStart(2, '0')}`
const currentMonthKey = `${todayKey}-01`

function defaultMonth (options: string[]) {
  const current = `${todayKey}-01`
  return options.find(item => item <= current) ?? options[0] ?? ''
}

const monthOptions = computed(() => {
  const keys = new Set<string>()
  for (const id of selectedIds.value) {
    for (const item of monthsByPlan.value[id] ?? []) keys.add(item.month)
  }
  return [...keys].sort((a, b) => b.localeCompare(a))
})

async function loadMonths () {
  const missing = selectedIds.value.filter(id => !monthsByPlan.value[id])
  await Promise.all(missing.map(async (id) => {
    const data = await $fetch<{ months: MonthSummary[] }>(`/api/ynab/${id}/months`)
    monthsByPlan.value[id] = data.months
  }))
  if (!month.value || !monthOptions.value.includes(month.value)) {
    month.value = defaultMonth(monthOptions.value)
  }
}

async function loadScheduled () {
  const missing = selectedIds.value.filter(id => !schedByPlan.value[id])
  await Promise.all(missing.map(async (id) => {
    try {
      const data = await $fetch<{ scheduled_transactions: ScheduledTransaction[] }>(`/api/ynab/${id}/scheduled`)
      schedByPlan.value[id] = data.scheduled_transactions
    } catch {
      schedByPlan.value[id] = [] // imports and expired tokens simply add no bills
    }
  }))
}

async function loadTransactions () {
  const missing = selectedIds.value.filter(id => !txnsByPlan.value[id])
  await Promise.all(missing.map(async (id) => {
    try {
      const data = await $fetch<Partial<TxnBundle> & { transactions: BudgetTransaction[] }>(`/api/ynab/${id}/transactions`)
      txnsByPlan.value[id] = { transactions: data.transactions, balance_now: data.balance_now ?? null, accounts: data.accounts ?? [], accounts_at: data.accounts_at ?? null }
    } catch {
      txnsByPlan.value[id] = { transactions: [], balance_now: null, accounts: [], accounts_at: null }
    }
  }))
}

// Live balances: one YNAB call per synced budget, so "cash on hand" is what
// the accounts hold right now rather than at the last full sync. Runs on
// every visit (throttled server-side) and from the picker's Refresh.
const accountsRefreshing = ref(false)
const accountsError = ref('')
async function refreshAccounts (ids = selectedIds.value.filter(id => kindByPlan.value[id] === 'synced' || id.startsWith('mock-'))) {
  if (!ids.length || accountsRefreshing.value) return
  accountsRefreshing.value = true
  accountsError.value = ''
  await Promise.all(ids.map(async (id) => {
    try {
      const data = await $fetch<{ accounts: BudgetAccount[], accounts_at: string }>(`/api/ynab/${id}/accounts`, { method: 'POST' })
      const bundle = txnsByPlan.value[id] ?? { transactions: [], balance_now: null, accounts: [], accounts_at: null }
      txnsByPlan.value[id] = { ...bundle, accounts: data.accounts, balance_now: data.accounts.reduce((sum, a) => sum + a.balance, 0), accounts_at: data.accounts_at }
    } catch (cause: unknown) {
      const err = cause as { data?: { statusMessage?: string } }
      accountsError.value = err.data?.statusMessage ?? 'Could not reach YNAB for live balances — showing the last synced ones.'
    }
  }))
  accountsRefreshing.value = false
}
const accountsAt = computed(() => {
  const stamps = selectedIds.value.map(id => txnsByPlan.value[id]?.accounts_at).filter((s): s is string => Boolean(s))
  return stamps.length ? stamps.sort()[0]! : null
})

async function loadPrefs () {
  const missing = selectedIds.value.filter(id => !prefsByPlan.value[id])
  await Promise.all(missing.map(async (id) => {
    try {
      const prefs = await $fetch<RecurringPrefs>(`/api/recurring/${id}`)
      prefsByPlan.value[id] = { ...prefs, accounts: prefs.accounts ?? emptyAccountPrefs() }
    } catch {
      prefsByPlan.value[id] = { confirmed: [], dismissed: [], custom: [], startingBalance: null, accounts: emptyAccountPrefs() }
    }
  }))
}

async function loadSourceKinds () {
  try {
    const data = await $fetch<{ sources: Array<{ id: string, kind: string }> }>('/api/sources')
    kindByPlan.value = Object.fromEntries(data.sources.map(s => [s.id, s.kind]))
  } catch { /* kinds only refine the balance math for imports */ }
}

async function loadDetails () {
  if (!month.value) return
  const entries = await Promise.all(selectedIds.value.map(async (id) => {
    const key = `${id}:${month.value}`
    if (!detailCache.has(key)) {
      const hasMonth = (monthsByPlan.value[id] ?? []).some(item => item.month === month.value)
      if (!hasMonth) {
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
  details.value = Object.fromEntries(entries)
}

onMounted(async () => {
  try {
    await load()
    if (!plans.value.length) {
      noPlans.value = true
      loading.value = false
      return
    }
    await Promise.all([loadMonths(), loadScheduled(), loadTransactions(), loadPrefs(), loadSourceKinds()])
    await loadDetails()
    refreshAccounts()
    try {
      const data = await $fetch<{ debts: Array<{ name: string, balance: number, hidden: boolean, history: unknown[] }> }>('/api/debt')
      debts.value = data.debts.filter(d => !d.hidden && d.history.length > 0)
    } catch { /* no debt context — day cards just skip the balance line */ }
  } catch {
    connectError.value = true
  }
  loading.value = false
})

watch(selectedIds, async () => {
  await Promise.all([loadMonths(), loadScheduled(), loadTransactions(), loadPrefs()])
  await loadDetails()
  refreshAccounts(selectedIds.value.filter(id => (kindByPlan.value[id] === 'synced' || id.startsWith('mock-')) && !txnsByPlan.value[id]?.accounts.length))
})
watch(month, loadDetails)

// ---- Recurring detection ---------------------------------------------------

// Series per source, with scheduled-transaction payees deduped out — a real
// YNAB schedule always wins over a detected copy of the same vendor.
const detectedBySource = computed(() => {
  const out: Record<string, DetectedSeries[]> = {}
  for (const id of selectedIds.value) {
    out[id] = detectSeries(txnsByPlan.value[id]?.transactions ?? [])
  }
  return out
})

const scheduledPayees = computed(() => {
  const out: Record<string, Set<string>> = {}
  for (const id of selectedIds.value) {
    out[id] = new Set((schedByPlan.value[id] ?? [])
      .map(txn => normalizePayee(txn.payee_name ?? ''))
      .filter(Boolean))
  }
  return out
})

type SourceSeries = DetectedSeries & { sourceId: string }

// Auto-charting series: gold + strong unless dismissed, maybes only when the
// user promoted them, scheduled duplicates never.
const activeSeries = computed<SourceSeries[]>(() => {
  const out: SourceSeries[] = []
  for (const id of selectedIds.value) {
    const prefs = prefsByPlan.value[id]
    const schedSet = scheduledPayees.value[id] ?? new Set()
    for (const series of detectedBySource.value[id] ?? []) {
      if (schedSet.has(series.normalizedPayee)) continue
      if (prefs?.dismissed.includes(series.key)) continue
      const auto = series.confidence !== 'maybe'
      const promoted = prefs?.confirmed.includes(series.key)
      if (auto || promoted) out.push({ ...series, sourceId: id })
    }
  }
  return out
})

// The "add monthly transactions" pool: unconfirmed maybes, plus anything the
// user dismissed (so a dismissal is always reversible from here).
const suggestions = computed<SourceSeries[]>(() => {
  const out: SourceSeries[] = []
  for (const id of selectedIds.value) {
    const prefs = prefsByPlan.value[id]
    const schedSet = scheduledPayees.value[id] ?? new Set()
    for (const series of detectedBySource.value[id] ?? []) {
      if (schedSet.has(series.normalizedPayee)) continue
      const dismissed = prefs?.dismissed.includes(series.key)
      const promoted = prefs?.confirmed.includes(series.key)
      if (dismissed || (series.confidence === 'maybe' && !promoted)) out.push({ ...series, sourceId: id })
    }
  }
  return out
})

const customs = computed<Array<CustomMonthly & { sourceId: string }>>(() =>
  selectedIds.value.flatMap(id => (prefsByPlan.value[id]?.custom ?? []).map(c => ({ ...c, sourceId: id }))))

async function savePrefs (sourceId: string) {
  const prefs = prefsByPlan.value[sourceId]
  if (!prefs) return
  try {
    await $fetch(`/api/recurring/${sourceId}`, { method: 'PUT', body: prefs })
    saveNote.value = ''
  } catch (cause: unknown) {
    const err = cause as { data?: { statusCode?: number } }
    saveNote.value = err.data?.statusCode === 401
      ? 'Sign in to save recurring choices — they reset with this page for now.'
      : 'Could not save that change — it applies until you leave the page.'
  }
}

function dismissSeries (series: SourceSeries) {
  const prefs = prefsByPlan.value[series.sourceId]
  if (!prefs) return
  prefs.confirmed = prefs.confirmed.filter(k => k !== series.key)
  if (!prefs.dismissed.includes(series.key)) prefs.dismissed.push(series.key)
  savePrefs(series.sourceId)
}

function addSeries (series: SourceSeries) {
  const prefs = prefsByPlan.value[series.sourceId]
  if (!prefs) return
  prefs.dismissed = prefs.dismissed.filter(k => k !== series.key)
  if (series.confidence === 'maybe' && !prefs.confirmed.includes(series.key)) {
    prefs.confirmed.push(series.key)
  }
  savePrefs(series.sourceId)
}

// ---- Custom monthlies (the hand-added kind) --------------------------------

const customForm = ref({ name: '', amount: '', day: '1', kind: 'bill' as 'bill' | 'income' })

function addCustom () {
  const sourceId = selectedIds.value[0]
  const prefs = sourceId ? prefsByPlan.value[sourceId] : null
  if (!sourceId || !prefs) return
  const dollars = Number.parseFloat(customForm.value.amount.replace(/[$,]/g, ''))
  const day = Math.round(Number(customForm.value.day))
  const name = customForm.value.name.trim()
  if (!name || !Number.isFinite(dollars) || dollars <= 0 || day < 1 || day > 31) return
  const amount = Math.round(dollars * 1000) * (customForm.value.kind === 'bill' ? -1 : 1)
  prefs.custom.push({ id: crypto.randomUUID(), name, amount, day, kind: customForm.value.kind })
  customForm.value = { name: '', amount: '', day: '1', kind: 'bill' }
  savePrefs(sourceId)
}

function removeCustom (item: CustomMonthly & { sourceId: string }) {
  const prefs = prefsByPlan.value[item.sourceId]
  if (!prefs) return
  prefs.custom = prefs.custom.filter(c => c.id !== item.id)
  savePrefs(item.sourceId)
}

// ---- Cash on hand ----------------------------------------------------------
// Every open on-budget account across the selected budgets (synced from
// YNAB, or typed by hand), each counted or not, with the total anchoring the
// balance line. Cards and credit lines carry negative balances, so the total
// is what's actually spendable today.

const cashFmt = (milliunits: number) => format(milliunits, selectedPlans.value[0]?.currency_format?.iso_code)

const cashRows = computed<CashRow[]>(() => {
  const rows: CashRow[] = []
  for (const id of selectedIds.value) {
    const sourceName = plans.value.find(p => p.id === id)?.name ?? 'Plan'
    const prefs = prefsByPlan.value[id]?.accounts ?? emptyAccountPrefs()
    for (const account of txnsByPlan.value[id]?.accounts ?? []) {
      const override = prefs.overrides[account.id]
      rows.push({
        sourceId: id,
        sourceName,
        id: account.id,
        name: account.name,
        kind: accountKind(account.type),
        balance: override ?? account.balance,
        syncedBalance: account.balance,
        overridden: override !== undefined,
        manual: false,
        included: !prefs.excluded.includes(account.id)
      })
    }
    for (const account of prefs.manual) {
      rows.push({
        sourceId: id,
        sourceName,
        id: account.id,
        name: account.name,
        kind: account.kind,
        balance: account.balance,
        syncedBalance: null,
        overridden: false,
        manual: true,
        included: !prefs.excluded.includes(account.id)
      })
    }
  }
  return rows
})

// Per source: the counted total, or null when the source lists no accounts
// (then the register net / starting balance carries the line as before).
const cashBySource = computed(() => {
  const map = new Map<string, number>()
  for (const row of cashRows.value) {
    if (!row.included) { if (!map.has(row.sourceId)) map.set(row.sourceId, 0); continue }
    map.set(row.sourceId, (map.get(row.sourceId) ?? 0) + row.balance)
  }
  return map
})
const cashOnHand = computed(() => cashRows.value.length ? [...cashBySource.value.values()].reduce((a, b) => a + b, 0) : null)
const cashSources = computed(() => selectedIds.value.map(id => ({ id, name: plans.value.find(p => p.id === id)?.name ?? 'Plan' })))

function accountPrefs (sourceId: string) {
  const prefs = prefsByPlan.value[sourceId]
  if (!prefs) return null
  prefs.accounts ??= emptyAccountPrefs()
  return prefs.accounts
}
function toggleAccount (row: CashRow) {
  const prefs = accountPrefs(row.sourceId)
  if (!prefs) return
  prefs.excluded = prefs.excluded.includes(row.id) ? prefs.excluded.filter(x => x !== row.id) : [...prefs.excluded, row.id]
  savePrefs(row.sourceId)
}
function setAccountBalance (row: CashRow, milliunits: number) {
  const prefs = accountPrefs(row.sourceId)
  if (!prefs) return
  if (row.manual) {
    const item = prefs.manual.find(a => a.id === row.id)
    if (item) item.balance = milliunits
  } else if (milliunits === row.syncedBalance) {
    delete prefs.overrides[row.id]
  } else {
    prefs.overrides[row.id] = milliunits
  }
  savePrefs(row.sourceId)
}
function clearAccountOverride (row: CashRow) {
  const prefs = accountPrefs(row.sourceId)
  if (!prefs) return
  delete prefs.overrides[row.id]
  savePrefs(row.sourceId)
}
function addManualAccount (sourceId: string, name: string, kind: 'cash' | 'credit', balance: number) {
  const prefs = accountPrefs(sourceId)
  if (!prefs) return
  prefs.manual.push({ id: `acct-${Math.random().toString(36).slice(2, 10)}`, name, kind, balance })
  savePrefs(sourceId)
}
function removeManualAccount (row: CashRow) {
  const prefs = accountPrefs(row.sourceId)
  if (!prefs) return
  prefs.manual = prefs.manual.filter(a => a.id !== row.id)
  prefs.excluded = prefs.excluded.filter(x => x !== row.id)
  delete prefs.overrides[row.id]
  savePrefs(row.sourceId)
}

// ---- Balance line ----------------------------------------------------------

// Everything a source expects to happen in a given month: detected series,
// scheduled transactions, and custom monthlies. The balance builder trims to
// after-the-anchor itself.
function projectedForSource (sourceId: string) {
  return (monthKey: string): Array<{ date: string, amount: number }> => {
    const out: Array<{ date: string, amount: number }> = []
    for (const series of activeSeries.value) {
      if (series.sourceId !== sourceId) continue
      for (const date of projectSeriesDates(series, monthKey)) out.push({ date, amount: series.amount })
    }
    for (const txn of schedByPlan.value[sourceId] ?? []) {
      for (const date of occurrencesInMonth(txn, monthKey)) out.push({ date, amount: txn.amount })
    }
    for (const item of prefsByPlan.value[sourceId]?.custom ?? []) {
      out.push({ date: customDateInMonth(item.day, monthKey), amount: item.amount })
    }
    return out
  }
}

const mornings = computed(() => {
  if (!month.value) return null
  const sources = selectedIds.value.map((id) => {
    const cash = cashBySource.value.get(id)
    const bundle = txnsByPlan.value[id]
    const transactions = bundle?.transactions ?? []
    // Counted accounts win over the sync-time sum. They're true as of the
    // moment YNAB reported them (or today, for hand-typed ones), which is
    // usually later than the register's last entry.
    const readAt = bundle?.accounts_at ? bundle.accounts_at.slice(0, 10) : todayIso
    return {
      transactions,
      balanceNow: cash ?? bundle?.balance_now ?? null,
      anchorDate: cash !== undefined ? (readAt > todayIso ? todayIso : readAt) : undefined,
      startingBalance: prefsByPlan.value[id]?.startingBalance ?? null,
      completeHistory: kindByPlan.value[id] === 'imported',
      projectedFor: projectedForSource(id)
    }
  })
  return buildMorningBalances(sources, month.value, currentMonthKey)
})

// The "Starting balance" input appears only when nothing anchors the line —
// no register-backed balance and no accounts in the cash-on-hand list.
const needsSeed = computed(() =>
  !selectedIds.value.some(id =>
    cashBySource.value.has(id)
    || ((txnsByPlan.value[id]?.balance_now ?? null) !== null && (txnsByPlan.value[id]?.transactions.length ?? 0) > 0)))

const seedInput = ref('')
// Prefs land asynchronously, so repopulate whenever they (or the need) change —
// but never clobber what the user is mid-typing with the same stored value.
watch([needsSeed, prefsByPlan, selectedIds], () => {
  if (!needsSeed.value) return
  const id = selectedIds.value[0]
  const stored = id ? prefsByPlan.value[id]?.startingBalance : null
  if (stored !== null && stored !== undefined && seedInput.value === '') {
    seedInput.value = String(stored / 1000)
  }
}, { immediate: true, deep: true })

function saveSeed () {
  const id = selectedIds.value.find(x => (txnsByPlan.value[x]?.balance_now ?? null) === null)
  const prefs = id ? prefsByPlan.value[id] : null
  if (!id || !prefs) return
  const dollars = Number.parseFloat(seedInput.value.replace(/[$,]/g, ''))
  prefs.startingBalance = Number.isFinite(dollars) ? Math.round(dollars * 1000) : null
  savePrefs(id)
}

// ---- Events ---------------------------------------------------------------

const goalCategories = computed(() => {
  // Goal categories across selected plans, deduped by id (shared plans repeat)
  const seen = new Map<string, Category>()
  for (const id of selectedIds.value) {
    for (const category of details.value[id]?.categories ?? []) {
      if (isGoalCategory(category) && !seen.has(category.id)) seen.set(category.id, category)
    }
  }
  return [...seen.values()]
})

const goalsDue = computed(() =>
  goalCategories.value.filter(c => c.goal_target_date?.slice(0, 7) === month.value.slice(0, 7)))

const debtByName = computed(() => {
  const map = new Map<string, number>()
  for (const d of debts.value) map.set(d.name.trim().toLowerCase(), Math.abs(d.balance))
  return map
})

function goalLeft (c: Category): number {
  return c.goal_overall_left ?? Math.max((c.goal_target ?? 0) - (c.goal_overall_funded ?? 0), 0)
}

const monthShort = (iso: string) => {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
}

// Category label for a detected series: its rows' dominant category.
const seriesCategory = computed(() => {
  const map = new Map<string, string>()
  for (const id of selectedIds.value) {
    const txns = txnsByPlan.value[id]?.transactions ?? []
    for (const series of detectedBySource.value[id] ?? []) {
      const cat = dominantCategory(txns, series.normalizedPayee)
      if (cat) map.set(`${id}|${series.key}`, cat)
    }
  }
  return map
})

// Vendors that belong to something planned — their register rows chart as
// planned occurrences; everything else is everyday spending and bundles.
const plannedIdentities = computed(() => {
  const out: Record<string, Set<string>> = {}
  for (const id of selectedIds.value) {
    const set = new Set<string>()
    for (const series of activeSeries.value) {
      if (series.sourceId === id) set.add(series.normalizedPayee)
    }
    for (const name of scheduledPayees.value[id] ?? []) set.add(name)
    for (const item of prefsByPlan.value[id]?.custom ?? []) set.add(normalizePayee(item.name))
    out[id] = set
  }
  return out
})

// Tinkrr-side label for a register row: its category; income's inflow bucket
// reads "Income"; a one-sided transfer falls back to the destination account.
function eventLabel (txn: BudgetTransaction): string {
  const category = txn.category?.trim()
  if (category && !/^inflow\b/i.test(category)) return category
  if (txn.amount > 0) return 'Income'
  if (txn.transfer) return txn.payee.replace(/^transfer\s*:\s*/i, '').trim() || 'Transfer'
  return category ? 'Income' : 'Uncategorized'
}

// ---- Rail accordions -------------------------------------------------------
// Every rail section collapses; choices persist. All open by default.
const RAIL_SECTIONS_KEY = 'ynabrr:calendar:rail-sections'
const railOpen = ref<Record<string, boolean>>({ day: true, month: true, recurring: true, goals: true, yearly: true })

onMounted(() => {
  try {
    const stored = JSON.parse(localStorage.getItem(RAIL_SECTIONS_KEY) ?? '{}')
    if (stored && typeof stored === 'object') railOpen.value = { ...railOpen.value, ...stored }
  } catch { /* defaults stand */ }
})

function toggleRail (key: string) {
  railOpen.value[key] = !railOpen.value[key]
  try {
    localStorage.setItem(RAIL_SECTIONS_KEY, JSON.stringify(railOpen.value))
  } catch { /* session-only is fine */ }
}

// The category a series charts under — shown before add/remove so the choice
// is informed, and as the collapsed-row context everywhere in the manager.
function seriesCategoryLabel (s: { sourceId: string, key: string }): string {
  return seriesCategory.value.get(`${s.sourceId}|${s.key}`) ?? 'Uncategorized'
}

const events = computed<DayEvent[]>(() => {
  const out: DayEvent[] = []
  if (!month.value) return out
  const monthPrefix = month.value.slice(0, 7)

  const push = (
    day: number, label: string, payee: string, amount: number,
    detail: string, planned: boolean, projected: boolean
  ) => {
    const bill = amount < 0
    out.push({
      kind: bill ? 'bill' : 'income',
      planned,
      projected,
      label,
      payee,
      amountLabel: `${bill ? '−' : '+'}${fmt(Math.abs(amount))}`,
      amountMilli: amount,
      detail,
      day
    })
  }

  // Actual register rows — planned vendors chart on their own, the rest is
  // everyday spending. Transfers with both sides in the register cancel and
  // never chart; a one-sided transfer (a loan payment leaving the budget) is
  // a real event, labeled by its category or the destination account.
  const actualToday = new Set<string>()
  for (const id of selectedIds.value) {
    const identities = plannedIdentities.value[id] ?? new Set<string>()
    const txns = txnsByPlan.value[id]?.transactions ?? []
    const paired = pairedTransferSet(txns)
    for (const txn of txns) {
      if (!txn.date.startsWith(monthPrefix) || txn.date > todayIso) continue
      if (paired.has(txn) || !txn.payee.trim() || txn.amount === 0) continue
      const normalized = normalizePayee(txn.payee)
      if (txn.date === todayIso) actualToday.add(normalized)
      push(
        Number(txn.date.slice(8, 10)),
        eventLabel(txn),
        txn.payee,
        txn.amount,
        txn.account || 'From the register',
        identities.has(normalized),
        false
      )
    }
  }

  // Projected: detected series (today onward; today only when no actual from
  // the same vendor has landed yet).
  for (const series of activeSeries.value) {
    const category = seriesCategory.value.get(`${series.sourceId}|${series.key}`)
    for (const date of projectSeriesDates(series, month.value)) {
      if (date < todayIso) continue
      if (date === todayIso && actualToday.has(series.normalizedPayee)) continue
      let detail = `Projected from ${monthShort(series.anchorDate)}'s ${fmt(Math.abs(series.amount))} · ${cadenceLabel(series)}`
      const debtBalance = debtByName.value.get(series.normalizedPayee)
      if (series.kind === 'bill' && debtBalance !== undefined) detail += ` · balance ${fmt(debtBalance)}`
      push(Number(date.slice(8, 10)), category ?? series.payee, series.payee, series.amount, detail, true, true)
    }
  }

  // Scheduled transactions — YNAB's own word for the future.
  for (const id of selectedIds.value) {
    for (const txn of schedByPlan.value[id] ?? []) {
      for (const date of occurrencesInMonth(txn, month.value)) {
        if (date < todayIso) continue
        const payee = txn.payee_name || txn.category_name || 'Scheduled'
        if (date === todayIso && actualToday.has(normalizePayee(payee))) continue
        let detail = `Scheduled ${frequencyLabel(txn.frequency)}${txn.account_name ? ` · ${txn.account_name}` : ''}`
        const debtBalance = debtByName.value.get(payee.replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase())
          ?? debtByName.value.get(payee.trim().toLowerCase())
        if (txn.amount < 0 && debtBalance !== undefined) detail += ` · balance ${fmt(debtBalance)}`
        const label = txn.category_name && !/^inflow\b/i.test(txn.category_name)
          ? txn.category_name
          : (txn.amount > 0 ? 'Income' : payee.replace(/^transfer\s*:\s*/i, '').trim() || payee)
        push(Number(date.slice(8, 10)), label, payee, txn.amount, detail, true, true)
      }
    }
  }

  // Hand-added monthlies — the user's own name IS the Tinkrr-side label.
  for (const item of customs.value) {
    const date = customDateInMonth(item.day, month.value)
    if (date < todayIso) continue
    push(Number(date.slice(8, 10)), item.name, item.name, item.amount, `Added by hand · always on the ${item.day}`, true, true)
  }

  for (const c of goalsDue.value) {
    const day = Number(c.goal_target_date!.slice(8, 10))
    const funded = c.goal_overall_funded ?? 0
    out.push({
      kind: 'goal',
      planned: true,
      projected: false,
      label: c.name,
      payee: c.name,
      amountLabel: `${fmt(goalLeft(c))} to go`,
      amountMilli: 0,
      detail: `Goal target date · ${funded > 0 ? `${fmt(funded)} of ${fmt(c.goal_target ?? 0)} funded` : 'nothing funded yet'}`,
      day
    })
  }
  return out.sort((a, b) => a.day - b.day)
})

// Chips: planned events only, biggest first, so the cap keeps what matters.
const PLANNED_CAP = 2

const plannedByDay = computed(() => {
  const map = new Map<number, DayEvent[]>()
  for (const ev of events.value) {
    if (!ev.planned) continue
    if (!map.has(ev.day)) map.set(ev.day, [])
    map.get(ev.day)!.push(ev)
  }
  for (const list of map.values()) {
    list.sort((a, b) => Math.abs(b.amountMilli) - Math.abs(a.amountMilli))
  }
  return map
})

// One quiet chip for the everyday rest: unplanned actuals plus any planned
// overflow past the cap — count and summed amount, details in the drill-in.
const bundleByDay = computed(() => {
  const daily = new Map<number, { count: number, net: number }>()
  for (const ev of events.value) {
    if (ev.planned) continue
    const entry = daily.get(ev.day) ?? { count: 0, net: 0 }
    entry.count++
    entry.net += ev.amountMilli
    daily.set(ev.day, entry)
  }
  const map = new Map<number, { count: number, label: string }>()
  const days = new Set([...daily.keys(), ...plannedByDay.value.keys()])
  for (const day of days) {
    const d = daily.get(day) ?? { count: 0, net: 0 }
    const overflow = (plannedByDay.value.get(day) ?? []).slice(PLANNED_CAP)
    const count = d.count + overflow.length
    if (!count) continue
    const net = d.net + overflow.reduce((sum, ev) => sum + ev.amountMilli, 0)
    const word = d.count ? (count === 1 ? 'other' : 'others') : 'more'
    const netLabel = net === 0 ? '' : ` · ${net < 0 ? '−' : '+'}${fmt(Math.abs(net))}`
    map.set(day, { count, label: `▪ ${count} ${word}${netLabel}` })
  }
  return map
})

// ---- Grid -----------------------------------------------------------------

const DOWS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

const grid = computed(() => {
  if (!month.value) return { cells: [] as Array<{ day: number | null }>, days: 0 }
  const [y, m] = month.value.split('-').map(Number)
  const first = new Date(Date.UTC(y!, m! - 1, 1))
  const days = new Date(Date.UTC(y!, m!, 0)).getUTCDate()
  const cells: Array<{ day: number | null }> = []
  for (let i = 0; i < first.getUTCDay(); i++) cells.push({ day: null })
  for (let d = 1; d <= days; d++) cells.push({ day: d })
  while (cells.length % 7) cells.push({ day: null })
  return { cells, days }
})

const viewingToday = computed(() => month.value.slice(0, 7) === todayKey)
const todayDay = today.getDate()

// Compact morning-balance figure for a cell ("$2.3k" over "$2,251.40" keeps
// the grid quiet); the day panel shows the exact number.
function balShort (milliunits: number): string {
  const dollars = milliunits / 1000
  const abs = Math.abs(dollars)
  const body = abs >= 10000 ? `${Math.round(abs / 1000)}k` : abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : String(Math.round(abs))
  return `${dollars < 0 ? '−' : ''}$${body}`
}

// Default the drill-in to today when viewing the current month.
watch(month, (value) => {
  selectedDay.value = value.slice(0, 7) === todayKey ? todayDay : null
}, { immediate: false })
watch(loading, () => {
  if (!loading.value && viewingToday.value && selectedDay.value === null) selectedDay.value = todayDay
})

const monthLabelLong = computed(() => {
  if (!month.value) return ''
  const [y, m] = month.value.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
})

const dayTitle = computed(() => {
  if (selectedDay.value === null) return 'Pick a day'
  const [y, m] = month.value.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, selectedDay.value)).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  })
})

// The drill-in shows every transaction of the day, grouped by Tinkrr's rows.
type DayGroup = { label: string, net: number, planned: boolean, projected: boolean, rows: DayEvent[] }

const dayGroups = computed<DayGroup[]>(() => {
  if (selectedDay.value === null) return []
  const map = new Map<string, DayGroup>()
  for (const ev of events.value) {
    if (ev.day !== selectedDay.value || ev.kind === 'goal') continue
    let group = map.get(ev.label)
    if (!group) {
      group = { label: ev.label, net: 0, planned: ev.planned, projected: true, rows: [] }
      map.set(ev.label, group)
    }
    group.net += ev.amountMilli
    group.planned = group.planned || ev.planned
    group.projected = group.projected && ev.projected
    group.rows.push(ev)
  }
  return [...map.values()].sort((a, b) =>
    Number(b.planned) - Number(a.planned) || Math.abs(b.net) - Math.abs(a.net))
})

const dayGoals = computed(() => selectedDay.value === null
  ? []
  : events.value.filter(ev => ev.day === selectedDay.value && ev.kind === 'goal'))

const dayMorning = computed(() =>
  selectedDay.value !== null ? mornings.value?.get(selectedDay.value) ?? null : null)
const dayNextMorning = computed(() =>
  selectedDay.value !== null ? mornings.value?.get(selectedDay.value + 1) ?? null : null)

// ---- Rail: goal pacing ----------------------------------------------------

function goalPct (c: Category): number {
  if (typeof c.goal_percentage_complete === 'number') return Math.min(c.goal_percentage_complete, 100)
  const target = c.goal_target ?? 0
  if (!target) return 0
  return Math.min(Math.round(((c.goal_overall_funded ?? 0) / target) * 100), 100)
}

const yearlyGoals = computed(() => {
  const monthKey = month.value.slice(0, 7)
  const monthNum = Number(month.value.slice(5, 7)) || 1
  return goalCategories.value
    .filter(c => c.goal_cadence === 13 || (c.goal_target_date && c.goal_target_date.slice(0, 7) > monthKey))
    .map((c) => {
      const target = c.goal_target ?? 0
      // Yearly-cadence goals accumulate in the category balance; dated goals
      // report goal_overall_funded.
      const funded = c.goal_overall_funded ?? Math.max(c.balance, 0)
      const p = target ? Math.min(funded / target, 1) : 0
      // Expected pace: months elapsed over a 12-month horizon toward the
      // target date; cadence-13 goals without a date pace with the calendar
      // year. An approximation, marked with the ▲ the design uses.
      let expect: number
      if (c.goal_target_date) {
        const [ty, tm] = c.goal_target_date.split('-').map(Number)
        const [vy, vm] = month.value.split('-').map(Number)
        const monthsLeft = Math.max((ty! - vy!) * 12 + (tm! - vm!), 0)
        expect = Math.min(Math.max(1 - monthsLeft / 12, 0), 1)
      } else {
        expect = monthNum / 12
      }
      const done = p >= 1
      const behind = !done && p < expect - 0.05
      const due = c.goal_target_date
        ? new Date(Date.UTC(Number(c.goal_target_date.slice(0, 4)), Number(c.goal_target_date.slice(5, 7)) - 1, 1))
            .toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) + ' ' + c.goal_target_date.slice(0, 4)
        : 'yearly'
      return {
        id: c.id,
        name: c.name,
        funded: `${fmt(funded)} funded`,
        target: `${fmt(target)} by ${due}`,
        pct: Math.round(p * 100),
        expectPct: Math.round(expect * 100),
        done,
        status: done ? 'done ✓' : behind ? 'behind pace' : 'on pace',
        tone: done ? 'ok' : behind ? 'warn' : 'teal'
      }
    })
})

// The rail's headline numbers — replaces the old "month at a glance".
const monthSummary = computed(() => {
  const money = events.value.filter(ev => ev.kind !== 'goal')
  const income = money.filter(ev => ev.amountMilli > 0).reduce((sum, ev) => sum + ev.amountMilli, 0)
  const plannedBills = money.filter(ev => ev.planned && ev.amountMilli < 0).reduce((sum, ev) => sum + ev.amountMilli, 0)
  const everyday = money.filter(ev => !ev.planned).reduce((sum, ev) => sum + ev.amountMilli, 0)
  const end = mornings.value?.get(grid.value.days + 1) ?? null
  return {
    income: income ? fmt(income) : '—',
    bills: plannedBills ? `−${fmt(Math.abs(plannedBills))}` : '—',
    everyday: everyday ? `${everyday < 0 ? '−' : '+'}${fmt(Math.abs(everyday))}` : '—',
    end: end !== null ? fmt(end) : null,
    endNegative: end !== null && end < 0
  }
})

// Suggestions stay out of the way: three at a time, the form behind a button.
const showAllSuggestions = ref(false)
const visibleSuggestions = computed(() =>
  showAllSuggestions.value ? suggestions.value : suggestions.value.slice(0, 3))
const showAddForm = ref(false)

const confidencePill: Record<string, { label: string, tone: string }> = {
  gold: { label: 'gold', tone: 'gold' },
  strong: { label: 'strong', tone: 'strong' },
  maybe: { label: 'maybe', tone: 'maybe' }
}
</script>

<template>
  <main class="page">
    <header class="top">
      <MonthStepper v-model="month" :options="monthOptions" />
      <PlanPicker
        :plans="plans"
        :selected="selectedIds"
        :label="label"
        caption="Plans shown"
        note="Bills and goals combine across selected plans."
        @toggle="toggle"
      />
      <CashPicker
        v-if="!loading && !noPlans && !connectError"
        :rows="cashRows"
        :total="cashOnHand"
        :sources="cashSources"
        :multi-source="selectedIds.length > 1"
        :fmt="cashFmt"
        :refreshed-at="accountsAt"
        :refreshing="accountsRefreshing"
        :error="accountsError"
        @refresh="refreshAccounts()"
        @toggle="toggleAccount"
        @set-balance="setAccountBalance"
        @clear-override="clearAccountOverride"
        @remove="removeManualAccount"
        @add="addManualAccount"
      />
      <div class="legend">
        <span class="key"><span class="dot bill" />Bill</span>
        <span class="key"><span class="dot income" />Income</span>
        <span class="key"><span class="dot goal" />Goal</span>
        <span class="key quiet"><span class="swatch projected" />projected</span>
        <span class="key quiet"><span class="dot bundle" />everyday</span>
      </div>
    </header>

    <p v-if="loading" class="y-body state">Loading your month…</p>
    <section v-else-if="noPlans || connectError" class="y-banner state">
      <span class="y-dot idle" />
      {{ connectError ? 'Something went wrong reaching your plans.' : 'No plans connected yet.' }}
      <NuxtLink to="/account" class="b">Add a token or import an export</NuxtLink>
    </section>

    <div v-else class="cal">
      <div v-for="d in DOWS" :key="d" class="dow">{{ d }}</div>
      <div
        v-for="(cell, i) in grid.cells"
        :key="i"
        class="cell"
        :class="{
          blank: cell.day === null,
          selected: cell.day !== null && cell.day === selectedDay
        }"
        @click="cell.day !== null && (selectedDay = cell.day)"
      >
        <div v-if="cell.day !== null" class="cell-head">
          <div
            class="num"
            :class="{ today: viewingToday && cell.day === todayDay }"
          >{{ cell.day }}</div>
          <div
            v-if="mornings?.has(cell.day)"
            class="bal"
            :class="{ negative: (mornings.get(cell.day) ?? 0) < 0 }"
            :title="`Morning balance ${fmt(mornings.get(cell.day)!)}`"
          >{{ balShort(mornings.get(cell.day)!) }}</div>
        </div>
        <template v-if="cell.day !== null">
          <div
            v-for="(ev, j) in (plannedByDay.get(cell.day) ?? []).slice(0, PLANNED_CAP)"
            :key="j"
            class="chip"
            :class="[ev.kind, { projected: ev.projected }]"
            :title="ev.payee"
          >{{ ev.label }}</div>
          <div
            v-if="bundleByDay.has(cell.day)"
            class="chip bundle"
            :title="`${bundleByDay.get(cell.day)!.count} more this day — click for the full list`"
          >{{ bundleByDay.get(cell.day)!.label }}</div>
        </template>
      </div>
    </div>

    <PageFooter class="desk-foot" />
  </main>

  <SideRail v-slot="{ wide }" storage-key="ynabrr:calendar-panel" expandable>
    <div :class="{ 'rail-wide': wide }">
    <button class="rail-head" :aria-expanded="railOpen.day" @click="toggleRail('day')">
      <span class="chev" :class="{ open: railOpen.day }">▸</span>
      <span class="rail-title">{{ dayTitle }}</span>
      <span v-if="!railOpen.day && dayMorning !== null" class="rail-hint-chip">{{ fmt(dayMorning) }}</span>
    </button>
    <div v-show="railOpen.day">

    <div v-if="dayMorning !== null" class="day-balance">
      Morning <b>{{ fmt(dayMorning) }}</b>
    </div>

    <div v-if="dayGroups.length || dayGoals.length" class="day-list">
      <div v-for="g in dayGroups" :key="g.label" class="day-card" :class="{ projected: g.projected }">
        <div class="day-head">
          <span class="day-name">
            {{ g.label }}<span v-if="g.rows.length > 1" class="day-count"> · {{ g.rows.length }} transactions</span>
          </span>
          <span class="day-amt" :class="g.net < 0 ? 'bill' : 'income'">
            {{ g.net < 0 ? '−' : '+' }}{{ fmt(Math.abs(g.net)) }}
          </span>
        </div>
        <template v-if="g.rows.length > 1">
          <div v-for="(row, i) in g.rows" :key="i" class="day-line" :title="row.payee">
            <span>{{ row.projected ? 'projected' : 'actual' }}</span>
            <span class="day-line-amt" :class="row.kind">{{ row.amountLabel }}</span>
          </div>
        </template>
        <div v-else class="day-detail" :title="g.rows[0]!.payee">{{ g.rows[0]!.detail }}</div>
      </div>
      <div v-for="(ev, i) in dayGoals" :key="`goal-${i}`" class="day-card">
        <div class="day-head">
          <span class="day-name">{{ ev.label }}</span>
          <span class="day-amt goal">{{ ev.amountLabel }}</span>
        </div>
        <div class="day-detail">{{ ev.detail }}</div>
      </div>
    </div>
    <div v-else class="rail-empty">
      Nothing planned or spent this day. Days with chips have the detail.
    </div>

    <div v-if="dayNextMorning !== null" class="day-balance next">
      Next morning <b :class="{ negative: dayNextMorning < 0 }">{{ fmt(dayNextMorning) }}</b>
    </div>

    </div>

    <div class="rail-section">
      <button class="rail-head" :aria-expanded="railOpen.month" @click="toggleRail('month')">
        <span class="chev" :class="{ open: railOpen.month }">▸</span>
        <span class="rail-title">This month</span>
        <span v-if="!railOpen.month" class="rail-hint-chip">{{ monthSummary.end }}</span>
      </button>
      <div v-show="railOpen.month">
      <div class="summary">
        <div class="summary-row"><span>Expected income</span><b class="income">{{ monthSummary.income }}</b></div>
        <div class="summary-row"><span>Planned bills</span><b class="bill">{{ monthSummary.bills }}</b></div>
        <div class="summary-row"><span>Everyday spending</span><b>{{ monthSummary.everyday }}</b></div>
        <div v-if="monthSummary.end" class="summary-row end">
          <span>End of month, projected</span>
          <b :class="{ negative: monthSummary.endNegative }">{{ monthSummary.end }}</b>
        </div>
      </div>
      </div>
    </div>

    <div class="rail-section">
      <button class="rail-head" :aria-expanded="railOpen.recurring" @click="toggleRail('recurring')">
        <span class="chev" :class="{ open: railOpen.recurring }">▸</span>
        <span class="rail-title">Planned &amp; recurring</span>
        <span v-if="!railOpen.recurring" class="rail-hint-chip">{{ activeSeries.length + customs.length }} active</span>
      </button>
      <div v-show="railOpen.recurring">

      <div v-if="activeSeries.length" class="rec-list">
        <div v-for="s in activeSeries" :key="`${s.sourceId}|${s.key}`" class="rec-row">
          <div class="rec-main">
            <div class="rec-name">{{ s.payee }}</div>
            <div class="rec-sub">
              <span class="rec-cat" :title="`Charts under this Tinkrr category`">{{ seriesCategoryLabel(s) }}</span>
              {{ cadenceLabel(s) }} · {{ s.kind === 'bill' ? '−' : '+' }}{{ fmt(Math.abs(s.amount)) }}
            </div>
          </div>
          <span class="conf" :class="confidencePill[s.confidence]!.tone">{{ confidencePill[s.confidence]!.label }}</span>
          <button class="rec-x" :title="`Stop charting ${s.payee} (under ${seriesCategoryLabel(s)})`" @click="dismissSeries(s)">✕</button>
        </div>
      </div>
      <div v-else class="rail-empty">
        Nothing recurring detected yet — it takes a few months of history.
      </div>

      <template v-if="customs.length">
        <div class="rec-subtitle">Added by hand</div>
        <div class="rec-list">
          <div v-for="c in customs" :key="c.id" class="rec-row">
            <div class="rec-main">
              <div class="rec-name">{{ c.name }}</div>
              <div class="rec-sub">monthly · the {{ c.day }} · {{ c.kind === 'bill' ? '−' : '+' }}{{ fmt(Math.abs(c.amount)) }}</div>
            </div>
            <button class="rec-x" :title="`Remove ${c.name}`" @click="removeCustom(c)">✕</button>
          </div>
        </div>
      </template>

      <template v-if="suggestions.length">
        <div class="rec-subtitle">Suggestions — not confident, add if real</div>
        <div class="rec-list">
          <div v-for="s in visibleSuggestions" :key="`${s.sourceId}|${s.key}`" class="rec-row">
            <div class="rec-main">
              <div class="rec-name">{{ s.payee }}</div>
              <div class="rec-sub">
                <span class="rec-cat">{{ seriesCategoryLabel(s) }}</span>
                {{ cadenceLabel(s) }} · ~{{ fmt(Math.abs(s.amount)) }} · seen {{ s.occurrences }}×
              </div>
            </div>
            <button class="rec-add" :title="`Charts under ${seriesCategoryLabel(s)}`" @click="addSeries(s)">+ Add</button>
          </div>
        </div>
        <button
          v-if="suggestions.length > 3"
          class="rec-more"
          @click="showAllSuggestions = !showAllSuggestions"
        >{{ showAllSuggestions ? 'Show fewer' : `Show all ${suggestions.length}` }}</button>
      </template>

      <button v-if="!showAddForm" class="rec-more add" @click="showAddForm = true">
        + Add a monthly by hand
      </button>
      <div v-else class="rec-form">
        <input
          v-model="customForm.name"
          type="text"
          placeholder="Add a monthly… (name)"
          aria-label="Custom monthly name"
          maxlength="80"
          @keyup.enter="addCustom"
        >
        <div class="rec-form-row">
          <input
            v-model="customForm.amount"
            type="text"
            inputmode="decimal"
            placeholder="$"
            aria-label="Amount"
            @keyup.enter="addCustom"
          >
          <input
            v-model="customForm.day"
            type="number"
            min="1"
            max="31"
            aria-label="Day of month"
          >
          <select v-model="customForm.kind" aria-label="Bill or income">
            <option value="bill">bill</option>
            <option value="income">income</option>
          </select>
          <button class="rec-add" @click="addCustom">Add</button>
        </div>
      </div>

      <div v-if="needsSeed" class="seed">
        <label class="seed-label" for="seed-input">Starting balance</label>
        <input
          id="seed-input"
          v-model="seedInput"
          type="text"
          inputmode="decimal"
          placeholder="$0.00"
          @change="saveSeed"
          @keyup.enter="saveSeed"
        >
        <div class="rail-hint">No register or accounts here — give the balance line a starting point for this month, or add your accounts under “Cash on hand” above.</div>
      </div>

      <div v-if="saveNote" class="rail-hint note">{{ saveNote }}</div>
      </div>
    </div>

    <div class="rail-section">
      <button class="rail-head" :aria-expanded="railOpen.goals" @click="toggleRail('goals')">
        <span class="chev" :class="{ open: railOpen.goals }">▸</span>
        <span class="rail-title">Goals due this month</span>
        <span v-if="!railOpen.goals" class="rail-hint-chip">{{ goalsDue.length || '—' }}</span>
      </button>
      <div v-show="railOpen.goals">
      <div v-if="goalsDue.length" class="goal-list">
        <div v-for="c in goalsDue" :key="c.id">
          <div class="goal-row">
            <span>{{ c.name }}</span>
            <span class="goal-status">{{ goalPct(c) }}% · {{ fmt(goalLeft(c)) }} to go</span>
          </div>
          <div class="track"><div class="fill" :style="{ width: Math.max(goalPct(c), 2) + '%' }" /></div>
        </div>
      </div>
      <div v-else class="rail-empty">No goal target dates land in {{ monthLabelLong }}.</div>
      </div>
    </div>

    <div class="rail-section">
      <button class="rail-head" :aria-expanded="railOpen.yearly" @click="toggleRail('yearly')">
        <span class="chev" :class="{ open: railOpen.yearly }">▸</span>
        <span class="rail-title">Yearly goals</span>
      </button>
      <div v-show="railOpen.yearly">
      <div class="rail-hint">Funded so far vs. where the year says you should be (▲).</div>
      <div v-if="yearlyGoals.length" class="yearly-list">
        <div v-for="g in yearlyGoals" :key="g.id">
          <div class="yearly-head">
            <span class="yearly-name">{{ g.name }}</span>
            <span class="pace-pill" :class="g.tone">{{ g.status }}</span>
          </div>
          <div class="track tall">
            <div class="fill" :class="{ done: g.done }" :style="{ width: g.pct + '%' }" />
            <div v-if="!g.done" class="pace" :style="{ left: `calc(${g.expectPct}% - 4px)` }" />
          </div>
          <div class="yearly-caption"><span>{{ g.funded }}</span><span>{{ g.target }}</span></div>
        </div>
      </div>
      <div v-else class="rail-empty">No yearly goals in the selected plans.</div>
      </div>
    </div>

    </div>
  </SideRail>
  <PageFooter phone />
</template>

<style scoped>
.page {
  flex: 1;
  min-width: 0;
  padding: 22px 28px 60px;
}

.top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }

.legend {
  display: flex;
  gap: 14px;
  margin-left: auto;
  font-size: 12px;
  font-weight: 700;
  color: var(--fg-muted);
  align-items: center;
  flex-wrap: wrap;
}
.key { display: flex; gap: 6px; align-items: center; }
.key.quiet { color: var(--fg-faint); }
.dot { width: 9px; height: 9px; border-radius: 3px; }
.dot.bill { background: var(--danger); }
.dot.income { background: var(--ok-dot); }
.dot.goal { background: var(--teal); }
.swatch { width: 14px; height: 9px; border-radius: 2px; background: var(--fg-subtle); opacity: 0.3; }
.dot.bundle { background: var(--border-strong); }

.state { margin-top: 20px; }
.state .b { font-weight: 700; }
.y-dot.idle { background: var(--fg-faint); }

/* ---- month grid ---- */
.cal {
  margin-top: 16px;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-card);
  overflow: hidden;
}
.dow {
  padding: 9px 0;
  text-align: center;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.7px;
  color: var(--fg-subtle);
  border-bottom: 1.5px solid var(--border-soft);
  background: #f7f2e9;
}
.cell {
  min-width: 0;
  overflow: hidden;
  min-height: 86px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--border-hair);
  border-right: 1px solid var(--border-hair);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--bg-card);
}
.cell:nth-child(7n) { border-right: none; }
.cell.blank { background: #fcfaf5; cursor: default; }
.cell.selected { background: var(--teal-bg); box-shadow: inset 0 0 0 2px var(--teal); }

.cell-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.num { font-size: 12px; font-weight: 800; color: var(--fg-subtle); }
.num.today {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--teal);
  color: #fff;
  display: grid;
  place-items: center;
}
.bal {
  font-size: 12px;
  font-weight: 700;
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.bal.negative { color: var(--danger); }

.chip {
  font-size: 10.5px;
  font-weight: 700;
  color: #4a463c;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 2px 5px 2px 6px;
  border-radius: 5px;
  background: var(--bg-app);
  border-left: 3px solid var(--teal);
}
.chip.bill { border-left-color: var(--danger); }
.chip.income { border-left-color: var(--ok-dot); }
.chip.projected { opacity: 0.6; }
.chip.bundle {
  border-left-color: var(--border-strong);
  color: var(--fg-subtle);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* ---- right rail ---- */
.rail-title {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--fg-subtle);
}

.day-balance {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--fg-muted);
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.day-balance b { font-variant-numeric: tabular-nums; }
.day-balance.next { border-top: 1px dashed var(--border); padding-top: 8px; }
.day-balance .negative { color: var(--danger); }

.day-list { margin-top: 12px; display: flex; flex-direction: column; gap: 9px; }
.day-card {
  background: var(--bg-app);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-field);
  padding: 10px 12px;
}
.day-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.day-name { font-weight: 800; font-size: 13.5px; min-width: 0; }
.day-amt { font-weight: 800; font-size: 13px; white-space: nowrap; }
.day-amt.bill { color: var(--danger); }
.day-amt.income { color: var(--ok); }
.day-amt.goal { color: var(--teal-dark); }
.day-detail { margin-top: 3px; font-size: 12px; color: var(--fg-subtle); }
.day-card.projected { border-style: dashed; }
.day-count { font-weight: 600; font-size: 11.5px; color: var(--fg-faint); }
.day-line {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--fg-faint);
}
.day-line-amt { font-weight: 700; font-variant-numeric: tabular-nums; }
.day-line-amt.bill { color: var(--danger); }
.day-line-amt.income { color: var(--ok); }

.rail-empty { margin-top: 12px; font-size: 12.5px; color: var(--fg-faint); line-height: 1.5; }

.rail-section { margin-top: 20px; border-top: 1.5px solid var(--border-soft); padding-top: 14px; }

.rail-head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
}
.chev {
  display: inline-block;
  color: var(--border-strong);
  font-size: 11px;
  transition: transform 0.15s;
}
.chev.open { transform: rotate(90deg); }
.rail-hint-chip {
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
  color: var(--fg-faint);
  white-space: nowrap;
}

.rec-cat {
  display: inline-block;
  background: var(--teal-badge);
  color: var(--teal-dark);
  font-size: 10.5px;
  font-weight: 800;
  border-radius: var(--r-pill);
  padding: 1px 8px;
  margin-right: 4px;
  vertical-align: 1px;
}

/* ---- wide layout: room to breathe, two-up cards ---- */
.rail-wide .day-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}
.rail-wide .rec-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 14px;
}
.rail-wide .rec-row { min-width: 0; }
.rail-wide .goal-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 18px;
}
.rail-hint { margin-top: 6px; font-size: 11.5px; color: var(--fg-faint); }
.rail-hint.note { color: var(--warn); }

/* ---- recurring ---- */
.rec-list { margin-top: 10px; display: flex; flex-direction: column; gap: 7px; }
.rec-subtitle {
  margin-top: 14px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--fg-faint);
}
.rec-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-app);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-sm);
  padding: 7px 10px;
}
.rec-main { min-width: 0; flex: 1; }
.rec-name { font-weight: 700; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rec-sub { font-size: 11px; color: var(--fg-subtle); }
.conf {
  flex: none;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  border-radius: var(--r-pill);
  padding: 2px 8px;
}
.conf.gold { background: var(--teal-badge); color: var(--teal-dark); }
.conf.strong { background: var(--ok-bg); color: var(--ok); }
.conf.maybe { background: var(--neutral-bg); color: var(--fg-muted); }
.rec-x {
  flex: none;
  border: none;
  background: none;
  color: var(--border-strong);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  padding: 0 2px;
}
.rec-x:hover { color: var(--danger); }
.rec-add {
  flex: none;
  border: 1.5px solid var(--teal);
  border-radius: var(--r-xs);
  background: var(--bg-card);
  color: var(--teal-dark);
  font-weight: 800;
  font-size: 11px;
  padding: 4px 10px;
  cursor: pointer;
}
.rec-add:hover { background: var(--teal-bg); }

.rec-form { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.rec-form input, .rec-form select {
  padding: 6px 9px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-xs);
  font-size: 12px;
  background: var(--bg-input);
  min-width: 0;
}
.rec-form input:focus, .rec-form select:focus { border-color: var(--teal); outline: none; }
.rec-form-row { display: flex; gap: 6px; }
.rec-form-row input:first-child { width: 70px; }
.rec-form-row input[type='number'] { width: 52px; }
.rec-form-row select { flex: 1; }

.seed { margin-top: 14px; }
.seed-label {
  display: block;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--fg-subtle);
  margin-bottom: 4px;
}
.seed input {
  width: 120px;
  padding: 6px 9px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-xs);
  font-size: 12.5px;
  font-weight: 700;
  background: var(--bg-input);
}
.seed input:focus { border-color: var(--teal); outline: none; }

.goal-list { margin-top: 12px; display: flex; flex-direction: column; gap: 12px; }
.goal-row { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; font-weight: 700; }
.goal-status { color: var(--fg-subtle); white-space: nowrap; }

.track {
  margin-top: 5px;
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: var(--neutral-bg);
  overflow: visible;
}
.track.tall { height: 7px; border-radius: 4px; }
.fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: var(--teal);
}
.fill.done { background: var(--ok-dot); }
.pace {
  position: absolute;
  top: -3px;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 6px solid var(--fg-subtle);
}

.yearly-list { margin-top: 12px; display: flex; flex-direction: column; gap: 13px; }
.yearly-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 12.5px; }
.yearly-name { font-weight: 700; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pace-pill {
  flex: none;
  font-size: 11px;
  font-weight: 800;
  border-radius: var(--r-pill);
  padding: 2px 8px;
}
.pace-pill.ok { background: var(--ok-bg); color: var(--ok); }
.pace-pill.warn { background: var(--warn-bg); color: var(--warn); }
.pace-pill.teal { background: var(--teal-badge); color: var(--teal-dark); }
.yearly-caption {
  margin-top: 4px;
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--fg-faint);
}

.summary { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
.summary-row { display: flex; justify-content: space-between; gap: 8px; }
.summary-row span { color: var(--fg-muted); }
.summary-row b { font-variant-numeric: tabular-nums; }
.summary-row b.income { color: var(--ok); }
.summary-row b.bill { color: var(--danger); }
.summary-row.end { border-top: 1px dashed var(--border); padding-top: 8px; font-weight: 700; }
.summary-row .negative { color: var(--danger); }

.rec-more {
  margin-top: 8px;
  border: none;
  background: none;
  color: var(--teal);
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.rec-more:hover { color: var(--teal-dark); }
.rec-more.add { margin-top: 12px; }

@media (max-width: 860px) {
  .page { padding: 20px 16px 48px; }
  .cell { min-height: 64px; }
  .chip, .bal { display: none; }
}

/* ==== phone (<760px): compact month strip with event dots; the panel
   (selected day, this month, planned) renders inline below ==== */
@media (max-width: 759px) {
  .page { padding: 12px 14px 20px; }
  .desk-foot { display: none; }
  .top { gap: 10px; }
  .legend { display: none; }
  .cal { margin-top: 12px; }
  .dow { padding: 7px 0; font-size: 10px; letter-spacing: 0.4px; }
  .cell {
    min-height: 48px;
    padding: 4px 2px 5px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    overflow: visible;
  }
  .cell-head { justify-content: center; }
  .num { font-size: 13.5px; }
  .num.today { width: 26px; height: 26px; }
  .bal { display: none; }
  .chip, .chip.bundle {
    display: block;
    width: 6px;
    height: 6px;
    padding: 0;
    border: none;
    border-radius: 999px;
    font-size: 0;
    line-height: 0;
    background: var(--danger);
    opacity: 1;
  }
  .chip.income { background: var(--ok-dot); }
  .chip.goal { background: var(--teal); }
  .chip.projected { opacity: 0.55; }
  .chip.bundle { background: var(--border-strong); }
  .cell.selected { background: var(--teal-bg); }
}
</style>
