<script setup lang="ts">
useHead({ title: 'Tinkrr' })
import type { Category, MonthDetail, MonthSummary } from '#shared/types/ynab'
import { CURRENCIES } from '#shared/types/currency'
import type { TargetDraft } from '~/composables/useSandboxStructure'

// ---- Sources --------------------------------------------------------------
const sel = usePlanSelection()
const monthsByPlan = ref<Record<string, MonthSummary[]>>({})
const month = ref('')
const detailsByPlan = ref<Record<string, MonthDetail | null>>({})
const loading = ref(true)
const connectError = ref(false)
const isMock = ref(false)
const noSources = ref(false)

const { user: authUser, refresh: refreshAuth } = useAuth()

const HELP_KEY = 'ynabrr:sandbox:intro'
const showHelp = ref(false)

onMounted(async () => {
  try {
    showHelp.value = localStorage.getItem(HELP_KEY) !== 'dismissed'
  } catch {
    showHelp.value = true
  }

  try {
    const status = await $fetch<{ mock: boolean, hasPat: boolean, hasEnvPat: boolean }>('/api/ynab/status')
    isMock.value = status.mock
    hasWorkingPat.value = status.hasPat || status.hasEnvPat
    await refreshAuth()
    await sel.load()
    if (!sel.plans.value.length) {
      noSources.value = true
      loading.value = false
    }
  } catch {
    connectError.value = true
    loading.value = false
  }
})

function dismissHelp () {
  showHelp.value = false
  try {
    localStorage.setItem(HELP_KEY, 'dismissed')
  } catch { /* it will just reappear next visit */ }
}

// ---- Months ---------------------------------------------------------------
const monthOptions = computed(() => {
  const keys = new Set<string>()
  for (const id of sel.selectedIds.value) {
    for (const item of monthsByPlan.value[id] ?? []) keys.add(item.month)
  }
  return [...keys].sort((a, b) => b.localeCompare(a))
})

function defaultMonth (options: string[]) {
  const today = `${new Date().toISOString().slice(0, 7)}-01`
  return options.find(item => item <= today) ?? options[0] ?? ''
}

watch(sel.selectedIds, async (ids) => {
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
  if (!month.value || !sel.selectedIds.value.length) return
  const token = ++loadToken
  loading.value = true
  try {
    const entries = await Promise.all(sel.selectedIds.value.map(async (id) => {
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

watch([sel.selectedIds, month], loadDetails)

// ---- Draft + structure layers ---------------------------------------------
const { drafts, disabled, custom, setDraft, clearDraft, setDisabled, addCustom, renameCustom, removeCustom, resetAll } = useSandboxDrafts(() => month.value)
const structure = useSandboxStructure()

// ---- New budget (manual source) --------------------------------------------
// Same move as the Account page's "+ New budget": a budget with zero YNAB in
// its veins, born empty and built right here with groups and what-if rows.
const newBudget = ref({ open: false, name: '', currency: 'USD', busy: false, error: '' })

async function createBudget () {
  const name = newBudget.value.name.trim()
  if (!name || newBudget.value.busy) return
  newBudget.value.busy = true
  newBudget.value.error = ''
  try {
    const res = await $fetch<{ id: string }>('/api/sources/manual', {
      method: 'POST',
      body: { name, currency: newBudget.value.currency }
    })
    newBudget.value = { open: false, name: '', currency: 'USD', busy: false, error: '' }
    await sel.load()
    // Bring the newborn straight into the table.
    if (!sel.selectedIds.value.includes(res.id)) sel.toggle(res.id)
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    newBudget.value.error = err.data?.statusMessage ?? 'Could not create the plan.'
    newBudget.value.busy = false
  }
}

const isCustom = (category: Category) => category.id.startsWith('custom-')
const INCOME_KEY = '__income__'

// ---- Target drafts ---------------------------------------------------------
// A drafted target reshapes the category's goal locally: every consumer of
// goalMonthly — the Goal label, rollups, Required, hero pill, Difference —
// sees the drafted shape, while rawGoalMonthly keeps YNAB's truth for
// before/after displays and sync details.
// What-if rows draft targets too — theirs ride along on the create-cat push.
const targetDraftFor = (category: Category): TargetDraft | undefined =>
  structure.targets.value[category.id]

function effectiveGoalCategory (category: Category): Category {
  const draft = targetDraftFor(category)
  if (!draft) return category
  if (draft.target === null) {
    return {
      ...category,
      goal_type: null,
      goal_target: null,
      goal_cadence: null,
      goal_cadence_frequency: null,
      goal_target_date: null,
      goal_overall_left: null
    }
  }
  const base: Category = { ...category, goal_type: 'NEED', goal_target: draft.target, goal_overall_left: null }
  if (draft.targetDate) {
    return { ...base, goal_cadence: null, goal_cadence_frequency: null, goal_target_date: draft.targetDate }
  }
  const cadence = draft.frequency === 'weekly' ? 2 : draft.frequency === 'yearly' ? 13 : 1
  return { ...base, goal_cadence: cadence, goal_cadence_frequency: 1, goal_target_date: null }
}

const goalMonthly = (category: Category) => goalMonthlyFor(effectiveGoalCategory(category), month.value)
const rawGoalMonthly = (category: Category) => goalMonthlyFor(category, month.value)

// Does the draft actually differ from what YNAB already has? Idempotence:
// after a push + re-snapshot the shapes match and nothing re-derives. An
// explicit set-aside/refill choice always counts as a difference — the read
// API doesn't expose that flag, so it can't be compared away.
function targetDiffers (category: Category): boolean {
  const draft = targetDraftFor(category)
  if (!draft) return false
  if (draft.target === null) return Boolean(category.goal_type)
  if (typeof draft.needsWholeAmount === 'boolean') return true
  if (draft.targetDate) {
    return category.goal_target !== draft.target || category.goal_target_date !== draft.targetDate
  }
  const wantCadence = draft.frequency === 'weekly' ? 2 : draft.frequency === 'yearly' ? 13 : 1
  // Monthly is every month: MF, DEBT, and cadence-less NEED goals already
  // repeat monthly, so a monthly draft only differs by amount — an unchanged
  // save must not derive a phantom "rewrite as NEED" push.
  const plainMonthly = !category.goal_target_date && (
    category.goal_type === 'MF' || category.goal_type === 'DEBT'
    || (category.goal_type === 'NEED' && (category.goal_cadence == null || category.goal_cadence === 0))
  )
  if (plainMonthly && wantCadence === 1) return category.goal_target !== draft.target
  return category.goal_target !== draft.target
    || category.goal_type !== 'NEED'
    || category.goal_cadence !== wantCadence
    || (category.goal_cadence_frequency ?? 1) !== 1
}

// Local rename overrides apply everywhere a name is shown.
const catName = (category: Category) => structure.renames.value[category.id] ?? category.name

type DisplayGroup = { key: string, name: string, custom: boolean, categories: Category[] }
type PlanSection = { planId: string, planName: string, detail: MonthDetail | null, groups: DisplayGroup[] }

// The display model: YNAB truth per plan, then the local overlay — trash
// drops rows, the drag layout re-homes them (across groups AND budgets),
// custom groups and what-if rows append.
const sections = computed<PlanSection[]>(() => {
  const planIds = sel.selectedIds.value
  const trash = structure.trash.value
  const layout = structure.layout.value

  // catalog of everything loadable this month
  const catalog = new Map<string, Category>()
  const naturalByPlan = new Map<string, DisplayGroup[]>()
  for (const id of planIds) {
    const detail = detailsByPlan.value[id] ?? null
    const groups: DisplayGroup[] = []
    const byName = new Map<string, DisplayGroup>()
    for (const category of detail?.categories ?? []) {
      if (!isPlannableCategory(category)) continue
      if (trash[category.id]) continue
      const groupName = category.category_group_name ?? 'Other'
      let row = byName.get(groupName)
      if (!row) {
        row = { key: groupName, name: groupName, custom: false, categories: [] }
        byName.set(groupName, row)
        groups.push(row)
      }
      row.categories.push(category)
      catalog.set(category.id, category)
    }
    naturalByPlan.set(id, groups)
  }

  // what-if rows are synthetic categories that live in the current month
  for (const [id, row] of Object.entries(custom.value)) {
    if (trash[id]) continue
    if (!planIds.includes(row.planId)) continue
    catalog.set(id, {
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

  // layout claims — the drag overlay; only claims into selected plans apply
  const claimedBy = new Map<string, string>()
  for (const [key, ids] of Object.entries(layout)) {
    const planId = key.split('::')[0]!
    if (!planIds.includes(planId)) continue
    for (const id of ids) {
      if (catalog.has(id)) claimedBy.set(id, key)
    }
  }

  return planIds.map((planId) => {
    const detail = detailsByPlan.value[planId] ?? null
    const natural = naturalByPlan.get(planId) ?? []

    // group roster: natural groups in YNAB order, then this plan's custom groups
    const defs: Array<{ key: string, name: string, custom: boolean }> =
      natural.map(g => ({ key: g.key, name: g.name, custom: false }))
    for (const [key, def] of Object.entries(structure.customGroups.value)) {
      if (def.planId === planId) defs.push({ key, name: def.name, custom: true })
    }
    // unclaimed what-if rows may point at a group that has no other members
    for (const [id, row] of Object.entries(custom.value)) {
      if (row.planId !== planId || trash[id] || claimedBy.has(id)) continue
      if (!defs.some(d => d.key === row.groupName) && !row.groupName.startsWith('cgrp-')) {
        defs.push({ key: row.groupName, name: row.groupName, custom: false })
      }
    }

    const naturalMembers = new Map<string, Category[]>()
    for (const g of natural) naturalMembers.set(g.key, [...g.categories])
    for (const [id, row] of Object.entries(custom.value)) {
      if (row.planId !== planId || trash[id] || claimedBy.has(id)) continue
      const cat = catalog.get(id)
      if (!cat) continue
      const list = naturalMembers.get(row.groupName) ?? []
      list.push(cat)
      naturalMembers.set(row.groupName, list)
    }

    const groups: DisplayGroup[] = []
    for (const def of defs) {
      const layoutKey = `${planId}::${def.key}`
      const claimed = (layout[layoutKey] ?? [])
        .filter(id => claimedBy.get(id) === layoutKey)
        .map(id => catalog.get(id)!)
        .filter(Boolean)
      const rest = (naturalMembers.get(def.key) ?? []).filter(c => !claimedBy.has(c.id))
      const categories = [...claimed, ...rest]
      if (!categories.length && !def.custom) continue
      groups.push({ key: def.key, name: def.name, custom: def.custom, categories })
    }
    return {
      planId,
      planName: sel.plans.value.find(item => item.id === planId)?.name ?? 'Plan',
      detail,
      groups
    }
  })
})

const multiPlan = computed(() => sel.selectedIds.value.length > 1)
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

// ---- Scenario math --------------------------------------------------------
// New goal = the drafted target's monthly cost; Goal = what YNAB has today.
// Difference is the gap between the two — the only thing the page is about.
const draftFor = (category: Category) => goalMonthly(category)
const deltaFor = (category: Category) => draftFor(category) - rawGoalMonthly(category)
const isOff = (category: Category) => Boolean(disabled.value[category.id])
const effectiveMonthly = (category: Category) => isOff(category) ? 0 : draftFor(category)
const effectiveDelta = (category: Category) => effectiveMonthly(category) - rawGoalMonthly(category)
// Edited = the new goal differs from YNAB's, in amount or in shape.
const isEdited = (category: Category) =>
  !isOff(category) && (deltaFor(category) !== 0 || (Boolean(targetDraftFor(category)) && targetDiffers(category)))

const changes = computed(() => visibleCategories.value.filter(isEdited))
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
  changes.value.length > 0 || incomeDelta.value !== 0 || excluded.value.length > 0
)

const changeCount = computed(() =>
  changes.value.length + excluded.value.length + (incomeDelta.value !== 0 ? 1 : 0)
)

const goalCount = computed(() => visibleCategories.value.filter(category => !isCustom(category)).length)
const includedCount = computed(() =>
  goalCount.value - excluded.value.filter(category => !isCustom(category)).length
)

const requiredBase = computed(() =>
  visibleCategories.value.reduce((sum, category) => sum + rawGoalMonthly(category), 0)
)
const requiredTotal = computed(() => requiredBase.value + totalDelta.value)
const remainingBase = computed(() => incomeLive.value - requiredBase.value)
const remaining = computed(() => income.value - requiredTotal.value)

const groupMonthly = (group: DisplayGroup) => group.categories.reduce((sum, c) => sum + effectiveMonthly(c), 0)
const groupDelta = (group: DisplayGroup) => group.categories.reduce((sum, c) => sum + effectiveDelta(c), 0)
// Goal rollups are the stable baseline — edits and exclusions never move them.
const groupGoal = (group: DisplayGroup) => group.categories.reduce((sum, c) => sum + rawGoalMonthly(c), 0)
const sectionGoal = (section: PlanSection) => section.groups.reduce((sum, g) => sum + groupGoal(g), 0)
const sectionMonthly = (section: PlanSection) => section.groups.reduce((sum, g) => sum + groupMonthly(g), 0)
const sectionDelta = (section: PlanSection) => section.groups.reduce((sum, g) => sum + groupDelta(g), 0)
const sectionCategories = (section: PlanSection) => section.groups.flatMap(g => g.categories)

// Difference pills: negative frees money (green), positive adds cost (red).
const pillClass = (delta: number): string => {
  if (delta === 0) return 'pill-zero'
  return delta < 0 ? 'pill pill-good' : 'pill pill-bad'
}

// ---- Chips + filter -------------------------------------------------------
type ChipKey = 'All' | 'Edited' | 'Excluded' | 'Trash'
const chip = ref<ChipKey>('All')
const filter = ref('')

const filterNeedle = computed(() => filter.value.trim().toLowerCase())
const filterActive = computed(() => filterNeedle.value !== '')
const matchesFilter = (category: Category) =>
  !filterActive.value ||
  catName(category).toLowerCase().includes(filterNeedle.value) ||
  (category.category_group_name ?? '').toLowerCase().includes(filterNeedle.value)

const chipMatch = (category: Category) => {
  if (chip.value === 'Edited') return isEdited(category)
  if (chip.value === 'Excluded') return isOff(category)
  return true
}
const rowVisible = (category: Category) => chipMatch(category) && matchesFilter(category)
const groupHasMatch = (group: DisplayGroup) => group.categories.some(rowVisible)
const sectionHasMatch = (section: PlanSection) => section.groups.some(groupHasMatch)
const anyMatch = computed(() => sections.value.some(sectionHasMatch))

// Filter or a non-All chip overrides the accordions so matches always surface.
const forceOpen = computed(() => filterActive.value || chip.value !== 'All')

const trashCount = computed(() => Object.keys(structure.trash.value).length)
const chips = computed(() => ([
  { key: 'All' as ChipKey, label: 'All' },
  { key: 'Edited' as ChipKey, label: `Edited · ${changes.value.length}` },
  { key: 'Excluded' as ChipKey, label: `Excluded · ${excluded.value.length}` },
  { key: 'Trash' as ChipKey, label: `Trash · ${trashCount.value}` }
]))

// ---- Accordions -----------------------------------------------------------
const COLLAPSED_PLANS_KEY = 'ynabrr:sandbox:collapsed-plans'
const COLLAPSED_GROUPS_KEY = 'ynabrr:sandbox:collapsed-groups'
const collapsedPlans = ref<Record<string, boolean>>({})
const collapsedGroups = ref<Record<string, boolean>>({})

onMounted(() => {
  try {
    collapsedPlans.value = JSON.parse(localStorage.getItem(COLLAPSED_PLANS_KEY) ?? '{}')
    collapsedGroups.value = JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? '{}')
  } catch { /* accordions just start open */ }
})
watch(collapsedPlans, (value) => {
  try { localStorage.setItem(COLLAPSED_PLANS_KEY, JSON.stringify(value)) } catch { /* session-only */ }
}, { deep: true })
watch(collapsedGroups, (value) => {
  try { localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(value)) } catch { /* session-only */ }
}, { deep: true })

const groupAccKey = (section: PlanSection, group: DisplayGroup) => `${section.planId}:${group.key}`
const planOpen = (section: PlanSection) => forceOpen.value || !multiPlan.value || !collapsedPlans.value[section.planId]
const groupOpen = (section: PlanSection, group: DisplayGroup) => forceOpen.value || !collapsedGroups.value[groupAccKey(section, group)]
const togglePlanOpen = (section: PlanSection) => {
  if (forceOpen.value) return
  collapsedPlans.value[section.planId] = !collapsedPlans.value[section.planId]
}
const toggleGroupOpen = (section: PlanSection, group: DisplayGroup) => {
  if (forceOpen.value) return
  const key = groupAccKey(section, group)
  collapsedGroups.value[key] = !collapsedGroups.value[key]
}
const editedCount = (categories: Category[]) =>
  categories.filter(category => isEdited(category)).length
const offCount = (categories: Category[]) => categories.filter(category => isOff(category)).length
const collapsedHint = (categories: Category[]) => {
  const parts: string[] = []
  if (editedCount(categories)) parts.push(`${editedCount(categories)} edited`)
  if (offCount(categories)) parts.push(`${offCount(categories)} off`)
  return parts.join(' · ')
}

const groupAllOff = (group: DisplayGroup) => group.categories.length > 0 && group.categories.every(isOff)
const groupMixed = (group: DisplayGroup) => !groupAllOff(group) && group.categories.some(isOff)
const toggleGroupIncluded = (group: DisplayGroup) => {
  const turnOff = group.categories.some(category => !isOff(category))
  for (const category of group.categories) setDisabled(category.id, turnOff)
}

// ---- Formatting -----------------------------------------------------------
const formatter = computed(() => {
  const first = sel.plans.value.find(item => item.id === sel.selectedIds.value[0])
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: first?.currency_format?.iso_code || 'USD'
  })
})
const fmt = (milliunits: number) => formatter.value.format(milliunits / 1000)
const fmtDelta = (milliunits: number) => `${milliunits > 0 ? '+' : '−'}${fmt(Math.abs(milliunits))}`

const monthName = computed(() => {
  if (!month.value) return 'This month'
  const [y, m] = month.value.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
})

function selectAll (event: Event) {
  (event.target as HTMLInputElement).select()
}
function blurOnEnter (event: Event) {
  (event.target as HTMLInputElement).blur()
}

// ---- Rename ---------------------------------------------------------------
const editingId = ref<string | null>(null)

function startRename (category: Category) {
  if (isCustom(category)) return
  editingId.value = category.id
  nextTick(() => document.getElementById(`rename-${category.id}`)?.focus())
}

function onRenameChange (category: Category, event: Event) {
  const value = (event.target as HTMLInputElement).value.trim()
  if (!value || value === category.name) structure.setRename(category.id, '')
  else structure.setRename(category.id, value)
}

function onGroupRename (key: string, event: Event) {
  structure.renameGroup(key, (event.target as HTMLInputElement).value)
}

// ---- Trash ----------------------------------------------------------------
function trashRow (section: PlanSection, group: DisplayGroup, category: Category) {
  structure.trashCategory(category.id, {
    planId: section.planId,
    planName: section.planName,
    group: group.name,
    name: catName(category) || 'Unnamed category',
    goal: rawGoalMonthly(category),
    custom: isCustom(category)
  })
}

const trashRows = computed(() =>
  Object.entries(structure.trash.value).map(([id, entry]) => ({ id, ...entry }))
)

function deleteForever (id: string) {
  structure.scrubCategory(id)
  removeCustom(id)
}

// ---- Drag & drop (across groups AND budgets) -------------------------------
const dragging = ref<string | null>(null)
const dropBeforeId = ref<string | null>(null)
const dropGroupKey = ref<string | null>(null)

function snapshotLayout (): Record<string, string[]> {
  const snapshot: Record<string, string[]> = {}
  for (const section of sections.value) {
    for (const group of section.groups) {
      snapshot[`${section.planId}::${group.key}`] = group.categories.map(c => c.id)
    }
  }
  return snapshot
}

function moveCategory (categoryId: string, toPlanId: string, toGroupKey: string, beforeId: string | null) {
  const snapshot = snapshotLayout()
  for (const ids of Object.values(snapshot)) {
    const i = ids.indexOf(categoryId)
    if (i >= 0) ids.splice(i, 1)
  }
  const targetKey = `${toPlanId}::${toGroupKey}`
  const target = snapshot[targetKey] ?? (snapshot[targetKey] = [])
  const index = beforeId ? target.indexOf(beforeId) : -1
  if (index >= 0) target.splice(index, 0, categoryId)
  else target.push(categoryId)
  structure.saveLayout(snapshot)
  const customRow = custom.value[categoryId]
  if (customRow) {
    customRow.planId = toPlanId
    customRow.groupName = toGroupKey
  }
}

function onDragStart (category: Category, event: DragEvent) {
  dragging.value = category.id
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function onDragEnd () {
  dragging.value = null
  dropBeforeId.value = null
  dropGroupKey.value = null
}
function onRowDragOver (category: Category, event: DragEvent) {
  if (!dragging.value || dragging.value === category.id) return
  event.preventDefault()
  dropBeforeId.value = category.id
  dropGroupKey.value = null
}
function onRowDrop (section: PlanSection, group: DisplayGroup, category: Category) {
  if (!dragging.value || dragging.value === category.id) return
  moveCategory(dragging.value, section.planId, group.key, category.id)
  onDragEnd()
}
function onGroupDragOver (section: PlanSection, group: DisplayGroup, event: DragEvent) {
  if (!dragging.value) return
  event.preventDefault()
  dropBeforeId.value = null
  dropGroupKey.value = `${section.planId}::${group.key}`
}
function onGroupDrop (section: PlanSection, group: DisplayGroup) {
  if (!dragging.value) return
  moveCategory(dragging.value, section.planId, group.key, null)
  onDragEnd()
}
function onPlanHeaderDragOver (section: PlanSection, event: DragEvent) {
  if (!dragging.value || !section.groups.length) return
  event.preventDefault()
  dropBeforeId.value = null
  dropGroupKey.value = `${section.planId}::header`
}
function onPlanHeaderDrop (section: PlanSection) {
  const first = section.groups[0]
  if (!dragging.value || !first) return
  moveCategory(dragging.value, section.planId, first.key, null)
  onDragEnd()
}

// ---- Amount editing -------------------------------------------------------
// Amount fields accept YNAB-style math ("+200", "1200/12"); after evaluating
// we write the normalized number back into the field ourselves, since Vue
// won't re-render when the bound value didn't change (e.g. invalid input).
// Typing in the New goal column drafts a plain monthly target of that amount
// (a weekly/yearly/by-date goal converts to monthly — the pen beside the field
// reshapes it). $0 removes the target; an empty field goes back to YNAB's.
function setMonthlyGoal (category: Category, milliunits: number) {
  if (milliunits <= 0) {
    if (isCustom(category)) structure.clearTarget(category.id)
    else structure.setTarget(category.id, { target: null })
  } else {
    structure.setTarget(category.id, { target: milliunits, frequency: 'monthly' })
  }
  if (!targetDiffers(category)) structure.clearTarget(category.id)
}

function onAmountChange (category: Category, event: Event) {
  const target = event.target as HTMLInputElement
  if (!target.value.trim()) {
    structure.clearTarget(category.id)
    target.value = fmt(draftFor(category))
    return
  }
  const result = evaluateAmountExpression(target.value, draftFor(category) / 1000)
  if (result !== null) setMonthlyGoal(category, Math.round(result * 1000))
  target.value = fmt(draftFor(category))
}

// Earlier builds kept a per-month "Monthly" amount beside the target; those
// become monthly target drafts the first time each month loads.
watch(drafts, (map) => {
  for (const [id, value] of Object.entries(map)) {
    if (id === INCOME_KEY) continue
    if (!structure.targets.value[id] && value > 0) structure.setTarget(id, { target: value, frequency: 'monthly' })
    clearDraft(id)
  }
}, { immediate: true })

function onIncomeChange (event: Event) {
  const target = event.target as HTMLInputElement
  if (!target.value.trim()) {
    clearDraft(INCOME_KEY)
    target.value = fmt(income.value)
    return
  }
  const result = evaluateAmountExpression(target.value, income.value / 1000)
  if (result !== null) {
    setDraft(INCOME_KEY, Math.round(result * 1000), incomeLive.value)
  }
  target.value = fmt(income.value)
}

function onAddRow (section: PlanSection, group: DisplayGroup) {
  const id = addCustom(section.planId, group.key)
  nextTick(() => document.getElementById(`custom-name-${id}`)?.focus())
}

function onCustomNameChange (id: string, event: Event) {
  renameCustom(id, (event.target as HTMLInputElement).value)
}

// ✕ on a what-if row: the row and every overlay keyed to it (target draft,
// layout claim) go together — orphaned entries would haunt localStorage.
function discardCustomRow (id: string) {
  structure.scrubCategory(id)
  removeCustom(id)
}

function resetEverything () {
  resetAll()
  structure.resetStructure()
}

// ---- Draft changes rail ---------------------------------------------------
const changesOpen = ref(true)

// ---- CSV export / import --------------------------------------------------
function csvEscape (value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function exportCsv () {
  const money = (milliunits: number) => (milliunits / 1000).toFixed(2)
  const lines = ['Budget,Group,Category,Goal / month,New goal,Difference,Included']
  for (const section of sections.value) {
    for (const group of section.groups) {
      for (const category of group.categories) {
        lines.push([
          csvEscape(section.planName),
          csvEscape(group.name),
          csvEscape(catName(category) || 'What-if row'),
          isCustom(category) ? '' : money(rawGoalMonthly(category)),
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
  link.download = `plannrr-scenario-${month.value.slice(0, 7)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function parseCsvLine (line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

const imported = ref(false)

// Restores a scenario from an exported CSV: rows matched by budget + category
// name (name alone as a fallback), Income from the summary tail. Rows that no
// longer exist are skipped silently.
function importCsv () {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.csv,text/csv'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const lines = String(reader.result).split(/\r?\n/)
        const byKey = new Map<string, Category>()
        for (const section of sections.value) {
          for (const group of section.groups) {
            for (const category of group.categories) {
              const name = catName(category).trim().toLowerCase()
              byKey.set(`${section.planName}|${name}`, category)
              if (!byKey.has(`|${name}`)) byKey.set(`|${name}`, category)
            }
          }
        }
        for (const line of lines.slice(1)) {
          if (!line.trim()) continue
          const cols = parseCsvLine(line)
          if (cols.length >= 5 && !cols[0] && !cols[1] && cols[2] === 'Income') {
            const value = Number.parseFloat(cols[4] ?? '')
            if (Number.isFinite(value)) {
              setDraft(INCOME_KEY, Math.round(value * 1000), incomeLive.value)
            }
            continue
          }
          if (cols.length < 7) continue
          if (cols[2] === 'Required' || cols[2] === 'Remaining') continue
          const name = (cols[2] ?? '').trim().toLowerCase()
          const hit = byKey.get(`${cols[0]}|${name}`) ?? byKey.get(`|${name}`)
          if (!hit) continue
          const included = (cols[6] ?? '').trim().toLowerCase() !== 'no'
          setDisabled(hit.id, !included)
          const monthly = Number.parseFloat(cols[4] ?? '')
          if (included && Number.isFinite(monthly)) {
            setMonthlyGoal(hit, Math.round(monthly * 1000))
          }
        }
        imported.value = true
        setTimeout(() => { imported.value = false }, 2000)
      } catch { /* unreadable file — leave the scenario untouched */ }
    }
    reader.readAsText(file)
  }
  input.click()
}


// ---- Sync to YNAB ---------------------------------------------------------
// The diff is simply the overlay: target drafts, renames, moves, custom groups
// and rows ARE the difference between this page and the snapshot truth. Each
// action maps to one YNAB API write via /api/ynab/push. Tinkrr plans; it
// never writes a month's assigned amount — excluding a row removes its
// target, nothing more.
// Verified against YNAB's API: hiding categories and cross-budget moves are
// impossible there — trash stays local, and a cross-budget move becomes
// "create it over there, exclude it here" (the review modal says so).

type SyncKind = 'update' | 'set-target' | 'move' | 'rename' | 'create-group' | 'create-cat' | 'exclude'

interface SyncAction {
  aid: string
  kind: SyncKind
  title: string
  detail: string
  sourceId: string
  exec: {
    categoryId?: string
    budgeted?: number
    setGoal?: number | null
    name?: string
    groupId?: string
    groupRef?: string      // custom group key whose create-group must run first
    goalTarget?: number | null
    localId?: string       // the custom row behind a create-cat
    movedId?: string       // the real category a cross-budget create-cat recreates
    targetDraft?: TargetDraft
    clearTarget?: boolean
  }
  dependsOn?: string
  // Derived from a budget that can't push yet (manual, unlinked). Rendered in
  // the review so the diff is complete, but never selectable or executed.
  blocked?: boolean
}

const SYNC_GROUP_META: Array<{ kind: SyncKind, name: string, hint: string }> = [
  { kind: 'set-target', name: 'Update target', hint: "rewrites the category's target in YNAB" },
  { kind: 'move', name: 'Move row', hint: 'category changes group' },
  { kind: 'rename', name: 'Rename category', hint: 'updates the name in YNAB' },
  { kind: 'create-group', name: 'Create group', hint: 'new category group in YNAB' },
  { kind: 'create-cat', name: 'Create category', hint: 'new category in YNAB' },
  { kind: 'exclude', name: 'Exclude from plan', hint: 'removes the target in YNAB (assigned money is left alone)' }
]
const SYNC_EXEC_ORDER: SyncKind[] = ['create-group', 'create-cat', 'move', 'rename', 'set-target', 'exclude']

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Which selected plans can push: snapshot sources synced from YNAB (any plan
// counts in mock mode — the server answers without writing).
const hasWorkingPat = ref(false)
const provenSync = ref(false)
const sourceKinds = ref<Record<string, string>>({})
let sourceKindsLoaded = false
async function loadSourceKinds (force = false) {
  if (isMock.value) return
  if (sourceKindsLoaded && !force) return
  try {
    const data = await $fetch<{ sources: Array<{ id: string, kind: string, lastSyncedAt: string | null }> }>('/api/sources')
    sourceKinds.value = Object.fromEntries(data.sources.map(row => [row.id, row.kind]))
    // "Proven": at least one synced source has actually pulled with this
    // account's token — the bar for letting anyone push.
    provenSync.value = data.sources.some(row => row.kind === 'synced' && row.lastSyncedAt)
    sourceKindsLoaded = true
  } catch { /* derivation treats everything as non-pushable until this loads */ }
}
onMounted(() => { loadSourceKinds() })

const pushable = (planId: string) => isMock.value || sourceKinds.value[planId] === 'synced'

// Where each real category actually lives in YNAB this month.
const naturalHome = computed(() => {
  const map = new Map<string, { planId: string, planName: string, groupId: string, groupName: string }>()
  for (const id of sel.selectedIds.value) {
    const planName = sel.plans.value.find(item => item.id === id)?.name ?? 'Plan'
    for (const category of detailsByPlan.value[id]?.categories ?? []) {
      map.set(category.id, {
        planId: id,
        planName,
        groupId: category.category_group_id,
        groupName: category.category_group_name ?? 'Other'
      })
    }
  }
  return map
})

// Real group ids by name, per plan — move/create targets.
const realGroupIds = computed(() => {
  const map = new Map<string, string>()
  for (const id of sel.selectedIds.value) {
    for (const category of detailsByPlan.value[id]?.categories ?? []) {
      if (category.category_group_name) map.set(`${id}::${category.category_group_name}`, category.category_group_id)
    }
  }
  return map
})

// Goals that already repeat monthly (MF, monthly or cadence-less NEED) — a
// Monthly-column edit updates these in place; anything else gets reshaped,
// and the review says so.
const simpleMonthlyGoal = (category: Category) =>
  category.goal_type === 'MF' ||
  (category.goal_type === 'NEED' && !category.goal_target_date && (
    category.goal_cadence == null || category.goal_cadence === 0
    || (category.goal_cadence === 1 && (category.goal_cadence_frequency ?? 1) === 1)
  ))

// The target a category carries into another budget: its drafted shape, or
// YNAB's own translated into what the API can write (odd cadences and
// build-to-balance goals travel as their monthly cost).
function carriedTarget (category: Category): TargetDraft | undefined {
  const draft = targetDraftFor(category)
  if (draft) return draft.target === null ? undefined : draft
  if (!category.goal_type || !category.goal_target) return undefined
  const cad = category.goal_cadence
  const freq = category.goal_cadence_frequency ?? 1
  if (cad === 2 && freq === 1) return { target: category.goal_target, frequency: 'weekly' }
  if (cad === 13 && freq === 1) return { target: category.goal_target, frequency: 'yearly' }
  if ((cad == null || cad === 0) && category.goal_target_date) return { target: category.goal_target, targetDate: category.goal_target_date }
  if (simpleMonthlyGoal(category) || category.goal_type === 'DEBT') return { target: category.goal_target, frequency: 'monthly' }
  const monthly = rawGoalMonthly(category)
  return monthly > 0 ? { target: monthly, frequency: 'monthly' } : undefined
}

const syncDerivation = computed(() => {
  const actions: SyncAction[] = []
  let crossBudget = 0
  let trashedReal = 0
  let unnamedCustom = 0
  const blockedSources = new Map<string, number>()
  const bump = (planId: string) => blockedSources.set(planId, (blockedSources.get(planId) ?? 0) + 1)

  for (const section of sections.value) {
    const sectionPush = pushable(section.planId)
    for (const group of section.groups) {
      if (group.custom) {
        if (sectionPush) {
          actions.push({
            aid: `grp-${section.planId}-${group.key}`,
            kind: 'create-group',
            title: `Create group “${group.name}”`,
            detail: `in ${section.planName}`,
            sourceId: section.planId,
            exec: { name: group.name, groupRef: group.key }
          })
        } else {
          bump(section.planId)
          actions.push({
              blocked: true,
            aid: `grp-${section.planId}-${group.key}`,
            kind: 'create-group',
            title: `Create group “${group.name}”`,
            detail: `in ${section.planName}`,
            sourceId: section.planId,
            exec: { name: group.name, groupRef: group.key }
          })
        }
      }
      for (const category of group.categories) {
        if (isCustom(category)) {
          const name = catName(category).trim()
          if (!name) { unnamedCustom++; continue }
          // The row's drafted target becomes the newborn category's goal.
          const rowTarget = targetDraftFor(category)
          const withTarget = rowTarget && rowTarget.target !== null ? rowTarget : undefined
          const detail = `in ${section.planName} · ${group.name}`
            + (withTarget ? ` · target ${targetDraftLabel(withTarget)}` : '')
          if (!sectionPush) {
            bump(section.planId)
            actions.push({
              blocked: true,
              aid: `new-${category.id}`,
              kind: 'create-cat',
              title: `Create “${name}”`,
              detail,
              sourceId: section.planId,
              exec: { name, localId: category.id }
            })
            continue
          }
          actions.push({
            aid: `new-${category.id}`,
            kind: 'create-cat',
            title: `Create “${name}”`,
            detail,
            sourceId: section.planId,
            exec: {
              name,
              localId: category.id,
              groupId: group.custom ? undefined : realGroupIds.value.get(`${section.planId}::${group.key}`),
              groupRef: group.custom ? group.key : undefined,
              targetDraft: withTarget
            },
            dependsOn: group.custom ? `grp-${section.planId}-${group.key}` : undefined
          })
          continue
        }

        const home = naturalHome.value.get(category.id)
        if (!home) continue
        const homePush = pushable(home.planId)

        const cross = home.planId !== section.planId
        if (cross && !isOff(category)) {
          // YNAB can't move a category between budgets, so the move becomes
          // two writes: recreate it in the destination (name, group, and
          // target carried along) and exclude it where it came from.
          crossBudget++
          const name = catName(category).trim() || category.name
          const carried = carriedTarget(category)
          const detail = `moved from ${home.planName} · into ${section.planName} · ${group.name}`
            + (carried ? ` · target ${targetDraftLabel(carried)}` : '')
          if (sectionPush) {
            actions.push({
              aid: `xnew-${category.id}`,
              kind: 'create-cat',
              title: `Create “${name}”`,
              detail,
              sourceId: section.planId,
              exec: {
                name,
                movedId: category.id,
                groupId: group.custom ? undefined : realGroupIds.value.get(`${section.planId}::${group.key}`),
                groupRef: group.custom ? group.key : undefined,
                targetDraft: carried
              },
              dependsOn: group.custom ? `grp-${section.planId}-${group.key}` : undefined
            })
          } else {
            bump(section.planId)
            actions.push({
              blocked: true,
              aid: `xnew-${category.id}`,
              kind: 'create-cat',
              title: `Create “${name}”`,
              detail,
              sourceId: section.planId,
              exec: { name, movedId: category.id }
            })
          }
          const offDetail = `moved to ${section.planName} — removes the target in ${home.planName}`
          if (homePush) {
            actions.push({
              aid: `xoff-${category.id}`,
              kind: 'exclude',
              title: catName(category),
              detail: offDetail,
              sourceId: home.planId,
              exec: { categoryId: category.id, clearTarget: true }
            })
          } else {
            bump(home.planId)
            actions.push({
              blocked: true,
              aid: `xoff-${category.id}`,
              kind: 'exclude',
              title: catName(category),
              detail: offDetail,
              sourceId: home.planId,
              exec: { categoryId: category.id }
            })
          }
          continue
        }

        if (!cross && (home.groupName !== group.name || group.custom)) {
          if (homePush) {
            actions.push({
              aid: `mov-${category.id}`,
              kind: 'move',
              title: catName(category),
              detail: `${home.groupName} → ${group.name}`,
              sourceId: home.planId,
              exec: {
                categoryId: category.id,
                groupId: group.custom ? undefined : realGroupIds.value.get(`${section.planId}::${group.key}`),
                groupRef: group.custom ? group.key : undefined
              },
              dependsOn: group.custom ? `grp-${section.planId}-${group.key}` : undefined
            })
          } else {
            bump(home.planId)
            actions.push({
              blocked: true,
              aid: `mov-${category.id}`,
              kind: 'move',
              title: catName(category),
              detail: `${home.groupName} → ${group.name}`,
              sourceId: home.planId,
              exec: { categoryId: category.id }
            })
          }
        }

        const renamed = structure.renames.value[category.id]
        if (!cross && renamed && renamed !== category.name) {
          if (homePush) {
            actions.push({
              aid: `ren-${category.id}`,
              kind: 'rename',
              title: `“${category.name}” → “${renamed}”`,
              detail: `in ${home.planName}`,
              sourceId: home.planId,
              exec: { categoryId: category.id, name: renamed }
            })
          } else {
            bump(home.planId)
            actions.push({
              blocked: true,
              aid: `ren-${category.id}`,
              kind: 'rename',
              title: `“${category.name}” → “${renamed}”`,
              detail: `in ${home.planName}`,
              sourceId: home.planId,
              exec: { categoryId: category.id, name: renamed }
            })
          }
        }

        // A drafted target that differs from YNAB's shape pushes the full
        // target rewrite (recurring cadence, by-date, or removal).
        const targetDraft = targetDraftFor(category)
        if (!cross && targetDraft && targetDiffers(category)) {
          if (homePush) {
            actions.push({
              aid: `tgt-${category.id}`,
              kind: 'set-target',
              title: catName(category),
              detail: targetActionDetail(category, targetDraft),
              sourceId: home.planId,
              exec: { categoryId: category.id, targetDraft }
            })
          } else {
            bump(home.planId)
            actions.push({
              blocked: true,
              aid: `tgt-${category.id}`,
              kind: 'set-target',
              title: catName(category),
              detail: targetActionDetail(category, targetDraft),
              sourceId: home.planId,
              exec: { categoryId: category.id, targetDraft }
            })
          }
        }

        // Excluded = out of the plan in YNAB too: the target is removed, and
        // that's all — assigned money is never touched. The row stays listed
        // (unticked, no target) after the push, so the exclusion stays visible.
        if (isOff(category) && !isCustom(category) && category.goal_type) {
          const detail = `excluded — removes the ${goalLabel(category) || 'existing'} target`
          if (homePush) {
            actions.push({
              aid: `off-${category.id}`,
              kind: 'exclude',
              title: catName(category),
              detail,
              sourceId: home.planId,
              exec: { categoryId: category.id, clearTarget: true }
            })
          } else {
            bump(home.planId)
            actions.push({
              blocked: true,
              aid: `off-${category.id}`,
              kind: 'exclude',
              title: catName(category),
              detail,
              sourceId: home.planId,
              exec: { categoryId: category.id }
            })
          }
        }
      }
    }
  }

  for (const entry of Object.values(structure.trash.value)) {
    if (entry.custom) continue
    if (!sel.selectedIds.value.includes(entry.planId)) continue
    if (pushable(entry.planId)) trashedReal++
  }

  const notes: string[] = []
  if (incomeDelta.value !== 0) notes.push(`your what-if income (${fmt(income.value)}) stays local — YNAB has no equivalent`)
  if (trashedReal) notes.push(`${trashedReal} trashed ${trashedReal === 1 ? 'row' : 'rows'} stay local — YNAB's API can't hide categories`)
  if (crossBudget) notes.push(`${crossBudget} cross-plan ${crossBudget === 1 ? 'move' : 'moves'}: YNAB can't move a category between plans, so it's created in the new plan and its target removed in the old one — hide the leftover there by hand`)
  if (unnamedCustom) notes.push(`${unnamedCustom} unnamed what-if ${unnamedCustom === 1 ? 'row' : 'rows'}`)
  const linkable: Array<{ planId: string, name: string, count: number }> = []
  for (const [planId, count] of blockedSources) {
    const name = sel.plans.value.find(item => item.id === planId)?.name ?? 'This plan'
    if (sourceKinds.value[planId] === 'manual') {
      // Manual budgets aren't dead ends — they can be linked and pushed.
      linkable.push({ planId, name, count })
    } else {
      notes.push(`“${name}” can't push — not a YNAB plan (${count} ${count === 1 ? 'change stays' : 'changes stay'} local)`)
    }
  }
  return { actions, notes, linkable }
})

// ---- Linking a manual budget to YNAB ---------------------------------------
// The YNAB API can't create budgets, so "sync a manual budget up" means:
// pick an existing (ideally empty) YNAB budget, link, and the next compare
// derives create-group / create-category / set-target actions for everything
// built here. Linking itself writes nothing to YNAB.
type AvailablePlan = { id: string, name: string, currency: string, synced: boolean }
const linkTargets = ref<AvailablePlan[]>([])
const linkChoice = ref<Record<string, string>>({})
const linkBusy = ref<string | null>(null)
const linkError = ref('')

const syncLinkable = computed(() => syncDerivation.value.linkable ?? [])

const linkRefreshing = ref(false)
async function refreshLinkTargets () {
  if (linkRefreshing.value) return
  linkRefreshing.value = true
  try {
    await loadLinkTargets()
  } finally {
    linkRefreshing.value = false
  }
}

async function loadLinkTargets () {
  try {
    const data = await $fetch<{ plans: AvailablePlan[] }>('/api/ynab/available')
    linkTargets.value = data.plans.filter(plan => !plan.synced)
  } catch { linkTargets.value = [] }
}

// Synced sources a manual budget can merge INTO (its content re-homes there).
const mergeTargets = computed(() =>
  sel.plans.value.filter(plan => sourceKinds.value[plan.id] === 'synced'))

async function linkManualSource (planId: string) {
  const choice = linkChoice.value[planId]
  if (!choice || linkBusy.value) return
  linkBusy.value = planId
  linkError.value = ''
  try {
    if (choice.startsWith('merge:')) {
      const toSourceId = choice.slice(6)
      // Client-side re-home: the manual budget's content is entirely a local
      // overlay, so merging is moving those claims to the destination and
      // dropping the empty shell.
      structure.mergeInto(planId, toSourceId)
      await $fetch(`/api/sources/${planId}`, { method: 'DELETE' })
      if (!sel.selectedIds.value.includes(toSourceId)) sel.toggle(toSourceId)
      await sel.load()
    } else {
      const ynabPlanId = choice.replace(/^link:/, '')
      await $fetch(`/api/sources/${planId}/link`, { method: 'POST', body: { ynabPlanId } })
    }
    await loadSourceKinds(true)
    await loadLinkTargets()
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    linkError.value = err.data?.statusMessage ?? 'Could not link that plan.'
  } finally {
    linkBusy.value = null
  }
}

// Pushing is earned: a saved token AND a successful pull with it. Anything
// less gets the Tinkrr Diff — the identical review, reading-only.
const canPush = computed(() => isMock.value || (hasWorkingPat.value && provenSync.value))

const syncActions = computed(() => syncDerivation.value.actions)
const syncNotes = computed(() => syncDerivation.value.notes)

const syncStep = ref<null | 'compare' | 'review' | 'push' | 'done'>(null)
const syncSel = ref<Record<string, boolean>>({})
const syncError = ref('')
const syncedCount = ref(0)
const mockRun = ref(false)

interface PushRow { aid: string, title: string, st: 'pending' | 'doing' | 'done' | 'failed' | 'skipped' }
const pushRows = ref<PushRow[]>([])

const selOn = (aid: string) => syncSel.value[aid] !== false
const blockedBy = (action: SyncAction) => (action.dependsOn && !selOn(action.dependsOn)) ? action.dependsOn : null
const effectiveOn = (action: SyncAction) => !action.blocked && selOn(action.aid) && !blockedBy(action)
const pickedCount = computed(() => syncActions.value.filter(effectiveOn).length)

const syncGroupRows = computed(() =>
  SYNC_GROUP_META
    .map(meta => ({ ...meta, rows: syncActions.value.filter(action => action.kind === meta.kind) }))
    .filter(group => group.rows.length)
)

function toggleSyncAction (action: SyncAction) {
  syncSel.value[action.aid] = !selOn(action.aid)
}
function toggleSyncGroup (group: { rows: SyncAction[] }) {
  const allOn = group.rows.every(action => selOn(action.aid))
  for (const action of group.rows) syncSel.value[action.aid] = !allOn
}
function blockTitle (action: SyncAction) {
  const parent = syncActions.value.find(a => a.aid === action.dependsOn)
  return parent ? `Needs ${parent.title.toLowerCase().startsWith('create group') ? '' : 'group '}“${parent.exec.name}” to be created first` : ''
}

const monthFull = computed(() => {
  if (!month.value) return ''
  const [y, m] = month.value.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
})

async function openSync () {
  if (!syncActions.value.length) return
  syncStep.value = 'compare'
  syncSel.value = {}
  syncError.value = ''
  linkError.value = ''
  mockRun.value = false
  const started = Date.now()
  // The compare IS real: refresh source kinds and this month's details so the
  // review diffs against fresh truth, not a stale cache.
  await loadSourceKinds(true)
  if (canPush.value && !isMock.value) await loadLinkTargets()
  for (const row of syncLinkable.value) {
    if (!(row.planId in linkChoice.value)) linkChoice.value[row.planId] = ''
  }
  for (const id of sel.selectedIds.value) detailCache.delete(`${id}:${month.value}`)
  await loadDetails()
  const waitLeft = 600 - (Date.now() - started)
  if (waitLeft > 0) await sleep(waitLeft)
  if (syncStep.value === 'compare') syncStep.value = 'review'
}

function closeSync () {
  if (syncStep.value === 'push' && !syncError.value) return // no accidental aborts mid-write
  syncStep.value = null
  pushRows.value = []
  syncError.value = ''
}

function onSyncKeydown (event: KeyboardEvent) {
  if (event.key === 'Escape') closeSync()
}
watch(syncStep, (step) => {
  if (!import.meta.client) return
  if (step) window.addEventListener('keydown', onSyncKeydown)
  else window.removeEventListener('keydown', onSyncKeydown)
})
onUnmounted(() => {
  if (import.meta.client) window.removeEventListener('keydown', onSyncKeydown)
})

const pushGlyph = (st: PushRow['st']) =>
  st === 'done' ? '✓' : st === 'doing' ? '⋯' : st === 'failed' ? '✗' : '○'
const pushStatus = (st: PushRow['st']) =>
  st === 'done' ? 'written' : st === 'doing' ? 'writing…' : st === 'failed' ? 'failed' : st === 'skipped' ? 'not written' : 'queued'

async function doSync () {
  const picked = SYNC_EXEC_ORDER.flatMap(kind => syncActions.value.filter(action => action.kind === kind && effectiveOn(action)))
  if (!picked.length) return

  syncStep.value = 'push'
  syncError.value = ''
  pushRows.value = picked.map(action => ({ aid: action.aid, title: action.title, st: 'pending' }))

  // One request per action; finalize rides on each source's last request so
  // its snapshot refreshes server-side.
  type Req = { actionIndex: number, sourceId: string, body: Record<string, unknown> }
  const requests: Req[] = []
  for (let i = 0; i < picked.length; i++) {
    const action = picked[i]!
    requests.push({ actionIndex: i, sourceId: action.sourceId, body: { kind: action.kind === 'exclude' ? 'exclude-clear' : action.kind } })
  }
  const lastReqBySource = new Map<string, number>()
  requests.forEach((req, index) => lastReqBySource.set(req.sourceId, index))

  const createdIds: Record<string, string> = {}
  const resolveGroupId = (action: SyncAction) =>
    action.exec.groupId ?? (action.exec.groupRef ? createdIds[`${action.sourceId}::${action.exec.groupRef}`] : undefined)

  let doneActions = 0
  for (let r = 0; r < requests.length; r++) {
    if (syncStep.value !== 'push') return // modal closed after a failure
    const req = requests[r]!
    const action = picked[req.actionIndex]!
    pushRows.value[req.actionIndex]!.st = 'doing'
    let body: Record<string, unknown>
    try {
      switch (req.body.kind as string) {
        case 'create-group':
          body = { kind: 'create-group', name: action.exec.name }
          break
        case 'create-cat': {
          const groupId = resolveGroupId(action)
          if (!isMock.value && !groupId) throw new Error(`No YNAB group to put “${action.exec.name}” in`)
          // A drafted target shape (cadence/date/style) trumps the bare
          // monthly amount — the server applies it to the newborn category.
          const rowTarget = action.exec.targetDraft
          body = {
            kind: 'create-cat',
            name: action.exec.name,
            groupId: groupId ?? '00000000-0000-4000-8000-000000000000',
            goalTarget: (rowTarget ? rowTarget.target : action.exec.goalTarget) ?? undefined,
            frequency: rowTarget && rowTarget.target !== null && !rowTarget.targetDate ? (rowTarget.frequency ?? 'monthly') : undefined,
            targetDate: rowTarget?.targetDate ?? undefined,
            needsWholeAmount: typeof rowTarget?.needsWholeAmount === 'boolean' ? rowTarget.needsWholeAmount : undefined
          }
          break
        }
        case 'move': {
          const groupId = resolveGroupId(action)
          if (!isMock.value && !groupId) throw new Error(`No YNAB group to move “${action.title}” into`)
          body = { kind: 'move', categoryId: action.exec.categoryId, groupId: groupId ?? '00000000-0000-4000-8000-000000000000' }
          break
        }
        case 'rename':
          body = { kind: 'rename', categoryId: action.exec.categoryId, name: action.exec.name }
          break
        case 'set-target': {
          const draft = action.exec.targetDraft!
          body = {
            kind: 'set-target',
            categoryId: action.exec.categoryId,
            goalTarget: draft.target,
            frequency: draft.target !== null && !draft.targetDate ? (draft.frequency ?? 'monthly') : undefined,
            targetDate: draft.targetDate ?? undefined,
            needsWholeAmount: typeof draft.needsWholeAmount === 'boolean' ? draft.needsWholeAmount : undefined
          }
          break
        }
        case 'exclude-clear':
          body = { kind: 'set-target', categoryId: action.exec.categoryId, goalTarget: null }
          break
        default:
          throw new Error(`Unknown sync request: ${req.body.kind}`)
      }
      const res = await $fetch<{ ok: boolean, createdId?: string | null, mocked?: boolean }>('/api/ynab/push', {
        method: 'POST',
        body: {
          sourceId: action.sourceId,
          month: month.value,
          action: body,
          finalize: lastReqBySource.get(req.sourceId) === r
        }
      })
      if (res.mocked) {
        mockRun.value = true
        await sleep(380)
      }
      if (action.kind === 'create-group' && res.createdId && action.exec.groupRef) {
        createdIds[`${action.sourceId}::${action.exec.groupRef}`] = res.createdId
      }
    } catch (cause: unknown) {
      const err = cause as { data?: { statusMessage?: string }, message?: string }
      pushRows.value[req.actionIndex]!.st = 'failed'
      for (const row of pushRows.value) {
        if (row.st === 'pending') row.st = 'skipped'
      }
      const written = doneActions
      syncError.value = `${err.data?.statusMessage ?? err.message ?? 'The push failed'}. `
        + `${written} of ${picked.length} ${written === 1 ? 'action was' : 'actions were'} written; your local drafts are unchanged — `
        + 're-sync from the Account page, then review again.'
      return
    }
    const isLastReqOfAction = r + 1 >= requests.length || requests[r + 1]!.actionIndex !== req.actionIndex
    if (isLastReqOfAction) {
      pushRows.value[req.actionIndex]!.st = 'done'
      doneActions++
      await sleep(120)
    }
  }

  // Success: retire the overlay entries that are now YNAB truth, then refetch.
  for (const action of picked) {
    if (action.kind === 'set-target') {
      structure.clearTarget(action.exec.categoryId!)
    } else if (action.kind === 'rename') {
      structure.setRename(action.exec.categoryId!, '')
    } else if (action.kind === 'move') {
      structure.releaseClaim(action.exec.categoryId!)
    } else if (action.kind === 'create-cat' && action.exec.localId) {
      structure.releaseClaim(action.exec.localId)
      structure.clearTarget(action.exec.localId)
      removeCustom(action.exec.localId)
    } else if (action.kind === 'create-cat' && action.exec.movedId) {
      // The recreated category comes back as truth in its new budget; the
      // original's local claim, rename, and target were all carried over.
      structure.releaseClaim(action.exec.movedId)
      structure.clearTarget(action.exec.movedId)
      structure.setRename(action.exec.movedId, '')
    } else if (action.kind === 'create-group' && action.exec.groupRef) {
      structure.renameLayoutKey(`${action.sourceId}::${action.exec.groupRef}`, `${action.sourceId}::${action.exec.name}`)
      structure.removeGroup(action.exec.groupRef)
    }
  }
  detailCache.clear()
  await loadDetails()
  syncedCount.value = picked.length
  syncStep.value = 'done'
}

// ---- Target editor ---------------------------------------------------------
// The popover behind the pen in every New goal cell: reshape a category's
// target — amount, cadence, by-date, set-aside vs refill — or convert any
// shape to its true monthly cost (goalMonthlyFor's math). Drafts overlay
// locally; sync writes.

type EditorCadence = 'monthly' | 'weekly' | 'yearly' | 'bydate' | 'none' | 'custom'

const targetEditor = ref<null | {
  categoryId: string
  amount: string
  cadence: EditorCadence
  date: string
  needs: 'aside' | 'refill' | null
  customLabel: string
}>(null)

const editingTargetCategory = computed(() =>
  targetEditor.value ? visibleCategories.value.find(c => c.id === targetEditor.value!.categoryId) ?? null : null)

function openTargetEditor (category: Category) {
  const draft = targetDraftFor(category)
  let cadence: EditorCadence
  let amount = 0
  let date = ''
  let needs: 'aside' | 'refill' | null = null
  let customLabel = ''
  if (draft) {
    amount = draft.target ?? 0
    if (draft.target === null) cadence = 'none'
    else if (draft.targetDate) { cadence = 'bydate'; date = draft.targetDate }
    else cadence = draft.frequency ?? 'monthly'
    if (typeof draft.needsWholeAmount === 'boolean') needs = draft.needsWholeAmount ? 'aside' : 'refill'
  } else if (isCustom(category)) {
    // A what-if row has no YNAB goal to mirror — start a fresh monthly target.
    cadence = 'monthly'
  } else {
    amount = category.goal_target ?? 0
    const cad = category.goal_cadence
    const freq = category.goal_cadence_frequency ?? 1
    if (!category.goal_type || !category.goal_target) cadence = 'none'
    else if (cad === 2 && freq === 1) cadence = 'weekly'
    else if (cad === 13 && freq === 1) cadence = 'yearly'
    else if ((cad == null || cad === 0) && category.goal_target_date) { cadence = 'bydate'; date = category.goal_target_date }
    else if (category.goal_type === 'TB') { cadence = 'custom'; customLabel = 'Build to a balance (YNAB-only)' }
    // Monthly is every month: MF, DEBT, and cadence-less goals are plain
    // monthly targets, not a frozen "(YNAB-only)" shape.
    else if (cadenceLabel(category) === '/ month') cadence = 'monthly'
    else { cadence = 'custom'; customLabel = `${cadenceLabel(category).replace('/ ', 'Every ')} (YNAB-only)` }
  }
  targetEditor.value = {
    categoryId: category.id,
    amount: amount ? (amount / 1000).toFixed(2) : '',
    cadence,
    date,
    needs,
    customLabel
  }
  nextTick(() => document.getElementById('target-amount-input')?.focus())
}

function closeTargetEditor () {
  targetEditor.value = null
}

// The editor's current state as milliunits, or null when unparsable/empty.
const editorAmount = computed(() => {
  const editor = targetEditor.value
  if (!editor) return null
  const parsed = evaluateAmountExpression(editor.amount, 0)
  if (parsed === null || parsed <= 0) return null
  return Math.round(parsed * 1000)
})

// What the editor's shape costs per month — the conversion figure.
const editorMonthly = computed(() => {
  const editor = targetEditor.value
  const category = editingTargetCategory.value
  if (!editor || !category) return null
  if (editor.cadence === 'custom') return rawGoalMonthly(category)
  const amount = editorAmount.value
  if (!amount) return null
  if (editor.cadence === 'none') return 0
  const probe: Category = editor.cadence === 'bydate'
    ? { ...category, goal_type: 'NEED', goal_target: amount, goal_cadence: null, goal_cadence_frequency: null, goal_target_date: editor.date || null, goal_overall_left: null }
    : { ...category, goal_type: 'NEED', goal_target: amount, goal_cadence: editor.cadence === 'weekly' ? 2 : editor.cadence === 'yearly' ? 13 : 1, goal_cadence_frequency: 1, goal_target_date: null, goal_overall_left: null }
  return goalMonthlyFor(probe, month.value)
})

const editorConvertible = computed(() => {
  const editor = targetEditor.value
  return Boolean(editor && editor.cadence !== 'monthly' && editor.cadence !== 'none' && editorMonthly.value)
})

function convertToMonthly () {
  const editor = targetEditor.value
  const monthly = editorMonthly.value
  if (!editor || !monthly) return
  editor.amount = (monthly / 1000).toFixed(2)
  editor.cadence = 'monthly'
  editor.date = ''
}

const editorSavable = computed(() => {
  const editor = targetEditor.value
  if (!editor) return false
  if (editor.cadence === 'custom') return false
  if (editor.cadence === 'none') return true
  if (!editorAmount.value) return false
  if (editor.cadence === 'bydate') return /^\d{4}-\d{2}-\d{2}$/.test(editor.date)
  return true
})

function saveTargetDraft () {
  const editor = targetEditor.value
  const category = editingTargetCategory.value
  if (!editor || !category || !editorSavable.value) return
  let draft: TargetDraft
  if (editor.cadence === 'none') {
    draft = { target: null }
  } else if (editor.cadence === 'bydate') {
    draft = { target: editorAmount.value!, targetDate: editor.date }
  } else {
    draft = {
      target: editorAmount.value!,
      frequency: editor.cadence,
      needsWholeAmount: editor.needs === null ? null : editor.needs === 'aside'
    }
  }
  structure.setTarget(category.id, draft)
  // A draft that lands exactly on YNAB's shape is no draft at all.
  if (!targetDiffers(category)) structure.clearTarget(category.id)
  closeTargetEditor()
}

function removeTargetDraft () {
  const category = editingTargetCategory.value
  if (!category) return
  structure.setTarget(category.id, { target: null })
  if (!targetDiffers(category)) structure.clearTarget(category.id)
  closeTargetEditor()
}

function onDocumentClick (event: MouseEvent) {
  if (!targetEditor.value) return
  const target = event.target as HTMLElement
  if (!target.closest('.target-pop') && !target.closest('.shape-btn')) closeTargetEditor()
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))

// ---- Labels ---------------------------------------------------------------
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

function shortDate (iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function targetDraftLabel (draft: TargetDraft) {
  if (draft.target === null) return 'no target'
  if (draft.targetDate) return `${fmt(draft.target)} by ${shortDate(draft.targetDate)}`
  const per = draft.frequency === 'weekly' ? '/ week' : draft.frequency === 'yearly' ? '/ year' : '/ month'
  return `${fmt(draft.target)} ${per}`
}

function rawTargetLabel (category: Category) {
  return goalLabel(category) || 'no target'
}

// The Goal cell is YNAB's truth, read-only: the target in its own period,
// plus its monthly cost when the period isn't a month.
function rawGoalCellLabel (category: Category) {
  if (isCustom(category)) return 'not in YNAB yet'
  return goalLabel(category) || 'no target'
}

function rawMonthlyHint (category: Category) {
  if (isCustom(category) || !category.goal_type || !category.goal_target) return ''
  const plainMonthly = !category.goal_target_date && category.goal_type !== 'TB' && cadenceLabel(category) === '/ month'
  return plainMonthly ? '' : `≈ ${fmt(rawGoalMonthly(category))} / month`
}

// Under the New goal amount: the drafted shape when it isn't a plain monthly
// target (the field itself already says "per month").
function newShapeCaption (category: Category) {
  const draft = targetDraftFor(category)
  if (!draft) return ''
  if (draft.target === null) return 'target removed'
  if (draft.targetDate || (draft.frequency && draft.frequency !== 'monthly')) return targetDraftLabel(draft)
  return ''
}

function shapeButtonTitle (category: Category) {
  if (isCustom(category)) return 'Shape this target: weekly, yearly, or by a date'
  return targetDraftFor(category)
    ? `Reshape the target — YNAB still says ${rawTargetLabel(category)}`
    : 'Reshape the target: weekly, yearly, or by a date'
}

function targetActionDetail (category: Category, draft: TargetDraft) {
  if (draft.target === null) return 'removes the target'
  return `${rawTargetLabel(category)} → ${targetDraftLabel(draft)}`
}
</script>

<template>
  <div class="wrap">
    <main class="page">
      <header class="top">
        <MonthStepper v-if="monthOptions.length" v-model="month" :options="monthOptions" />
        <PlanPicker
          v-if="sel.plans.value.length > 1"
          :plans="sel.plans.value"
          :selected="sel.selectedIds.value"
          :label="sel.label.value"
          caption="Tinker with"
          note="Income and goals add up across selected plans."
          @toggle="sel.toggle"
        />
        <div v-if="hasAnyDetail" class="hero" :class="{ neg: remaining < 0 }">
          <div class="hero-num">{{ fmt(remaining) }}</div>
          <div class="hero-sub">{{ remaining >= 0 ? 'Left over · income − required' : 'Over income' }}</div>
        </div>
        <span v-if="isMock" class="y-pill y-pill-warn" title="Serving built-in sample data — no YNAB account is being read">Mock data</span>
        <div class="head-right">
          <input
            v-model="filter"
            type="search"
            class="filter"
            placeholder="Filter categories…"
            aria-label="Filter categories by name"
            @keyup.escape="filter = ''"
          >
          <button class="help-btn" title="How this works" :aria-expanded="showHelp" @click="showHelp = !showHelp">?</button>
        </div>
      </header>

      <section v-if="showHelp" class="help">
        <div class="help-copy">
          <b>How Tinkrr works.</b> Every category with a goal shows up with what YNAB plans
          for it per month. Type a <b>New goal</b> (or a new Income) to see what your plan
          costs against what you expect to earn — the <b>Difference</b> column keeps score.
          Untick rows to leave them out, trash rows to drop them from the plan, drag the
          ⠿ handle to move a category into another group — or another plan. Fields do math
          like YNAB's: <code>1200/12</code>, <code>+200</code>. <b>Nothing is written to
          YNAB</b> until you sync — drafts live in this browser only.
        </div>
        <button class="y-btn-outline" @click="dismissHelp">Got it</button>
      </section>

      <section v-if="connectError || noSources" class="y-card empty-state">
        <h2>{{ connectError ? 'Something went wrong' : 'No plans connected yet' }}</h2>
        <p v-if="!authUser" class="y-body">
          <NuxtLink to="/login">Sign in</NuxtLink> to import a YNAB export or connect your
          own access token — or run the app in mock mode to play with sample data.
        </p>
        <p v-else class="y-body">
          Head to your <NuxtLink to="/account">account</NuxtLink> to import a YNAB export zip
          or save a personal access token, then come back here.
        </p>
      </section>

      <p v-else-if="loading && !hasAnyDetail" class="y-body loading-note">Loading plans…</p>

      <template v-else>
        <div v-if="sel.patError.value" class="y-banner warn-banner">
          <span class="y-dot idle" />
          Your saved YNAB token stopped working — live plans are hidden.
          <NuxtLink to="/account" class="b">Update it in your account</NuxtLink>
        </div>

        <div class="chips" role="tablist" aria-label="Filter rows">
          <button
            v-for="c in chips"
            :key="c.key"
            class="chip"
            :class="{ on: chip === c.key }"
            role="tab"
            :aria-selected="chip === c.key"
            @click="chip = c.key"
          >{{ c.label }}</button>
        </div>

        <!-- Trash view -->
        <section v-if="chip === 'Trash'" class="card">
          <div class="trash-title">Trash — removed from the plan, not counted anywhere</div>
          <div v-if="!trashRows.length" class="trash-empty">
            Trash is empty. The small trash icon on any row removes it from its plan and parks it here.
          </div>
          <div v-for="t in trashRows" :key="t.id" class="trash-row">
            <div class="trash-info">
              <div class="trash-name">{{ t.name }}</div>
              <div class="trash-origin">was in {{ t.planName }} · {{ t.group }} · goal {{ fmt(t.goal) }}</div>
            </div>
            <button class="y-btn-outline slim" @click="structure.restoreCategory(t.id)">Restore</button>
            <button v-if="t.custom" class="y-btn-danger" @click="deleteForever(t.id)">Delete forever</button>
          </div>
        </section>

        <!-- Table -->
        <section v-else class="card table-card" :class="{ 'pop-open': Boolean(targetEditor) }">
          <div class="grid head-row">
            <div>Category</div>
            <div>Goal <span class="head-hint">· in YNAB today</span></div>
            <div class="right teal-head">New goal <span class="head-hint">· per month, stays local</span></div>
            <div class="right">Difference</div>
          </div>

          <template v-for="section in sections" :key="section.planId">
            <div
              v-if="multiPlan && sectionHasMatch(section)"
              class="grid plan-row"
              :class="{ 'drop-into': dropGroupKey === `${section.planId}::header` }"
              @click="togglePlanOpen(section)"
              @dragover="onPlanHeaderDragOver(section, $event)"
              @drop="onPlanHeaderDrop(section)"
            >
              <div class="cell-name">
                <span class="chev" :class="{ open: planOpen(section) }">▸</span>
                <span class="strong">{{ section.planName }}</span>
                <span v-if="section.detail" class="soft">income {{ fmt(section.detail.income ?? 0) }}</span>
                <span v-if="!planOpen(section) && collapsedHint(sectionCategories(section))" class="soft hint">{{ collapsedHint(sectionCategories(section)) }}</span>
              </div>
              <div class="soft">{{ section.detail ? `${fmt(sectionGoal(section))} / month` : '' }}</div>
              <div class="right strong sm">{{ section.detail ? fmt(sectionMonthly(section)) : '' }}</div>
              <div class="right"><span :class="pillClass(sectionDelta(section))">{{ sectionDelta(section) !== 0 ? fmtDelta(sectionDelta(section)) : '—' }}</span></div>
            </div>
            <div v-if="multiPlan && !section.detail && planOpen(section) && !forceOpen" class="plan-empty">
              No data for this month in {{ section.planName }}.
            </div>

            <template v-if="planOpen(section)">
              <template v-for="group in section.groups" :key="section.planId + '::' + group.key">
                <div
                  v-if="groupHasMatch(group) || (!forceOpen && group.custom)"
                  class="grid group-row"
                  :class="{ 'drop-into': dropGroupKey === `${section.planId}::${group.key}` }"
                  @click="toggleGroupOpen(section, group)"
                  @dragover="onGroupDragOver(section, group, $event)"
                  @drop="onGroupDrop(section, group)"
                >
                  <div class="cell-name">
                    <input
                      type="checkbox"
                      class="check"
                      :checked="!groupAllOff(group)"
                      :indeterminate.prop="groupMixed(group)"
                      :aria-label="`Include ${group.name} in the math`"
                      @click.stop
                      @change="toggleGroupIncluded(group)"
                    >
                    <span class="chev" :class="{ open: groupOpen(section, group) }">▸</span>
                    <input
                      v-if="group.custom"
                      type="text"
                      class="rename-input dashed"
                      :value="group.name"
                      placeholder="Group name…"
                      aria-label="Group name"
                      @click.stop
                      @change="onGroupRename(group.key, $event)"
                    >
                    <span v-else class="strong g">{{ group.name }}</span>
                    <span v-if="!groupOpen(section, group) && collapsedHint(group.categories)" class="soft hint">{{ collapsedHint(group.categories) }}</span>
                  </div>
                  <div class="soft">{{ fmt(groupGoal(group)) }} / month</div>
                  <div class="right strong sm">{{ fmt(groupMonthly(group)) }}</div>
                  <div class="right"><span :class="pillClass(groupDelta(group))">{{ groupDelta(group) !== 0 ? fmtDelta(groupDelta(group)) : '—' }}</span></div>
                </div>

                <template v-if="groupOpen(section, group)">
                  <div
                    v-for="category in group.categories"
                    v-show="rowVisible(category)"
                    :key="category.id"
                    class="grid row"
                    :class="{
                      edited: isEdited(category),
                      off: isOff(category),
                      'drop-before': dropBeforeId === category.id,
                      lifting: dragging === category.id
                    }"
                    @dragover="onRowDragOver(category, $event)"
                    @drop="onRowDrop(section, group, category)"
                  >
                    <div class="cell-name">
                      <span
                        class="drag"
                        draggable="true"
                        title="Drag to another group or plan"
                        @dragstart="onDragStart(category, $event)"
                        @dragend="onDragEnd"
                      >⠿</span>
                      <input
                        type="checkbox"
                        class="check"
                        :checked="!isOff(category)"
                        :aria-label="`Include ${catName(category)} in the math`"
                        @change="setDisabled(category.id, !isOff(category))"
                      >
                      <input
                        v-if="isCustom(category)"
                        :id="`custom-name-${category.id}`"
                        type="text"
                        class="rename-input dashed"
                        placeholder="Category name…"
                        :value="category.name"
                        aria-label="What-if row name"
                        @change="onCustomNameChange(category.id, $event)"
                      >
                      <input
                        v-else-if="editingId === category.id"
                        :id="`rename-${category.id}`"
                        type="text"
                        class="rename-input active"
                        :value="catName(category)"
                        aria-label="Rename category"
                        @change="onRenameChange(category, $event)"
                        @blur="editingId = null"
                        @keydown.enter="blurOnEnter"
                      >
                      <template v-else>
                        <span
                          class="name-text"
                          :class="{ struck: isOff(category), renamed: Boolean(structure.renames.value[category.id]) }"
                          :title="structure.renames.value[category.id] ? `Renamed here only — YNAB still says “${category.name}”. Double-click to edit.` : 'Double-click to rename'"
                          @dblclick="startRename(category)"
                        >{{ catName(category) }}</span>
                        <button class="pen" title="Rename" @click="startRename(category)">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                        </button>
                      </template>
                    </div>
                    <div class="soft goal-cell" :title="isCustom(category) ? 'A what-if row has no goal in YNAB until you sync it' : 'What YNAB plans today — edit the New goal column instead'">
                      <span class="goal-raw">{{ rawGoalCellLabel(category) }}</span>
                      <span v-if="rawMonthlyHint(category)" class="goal-approx">{{ rawMonthlyHint(category) }}</span>
                    </div>
                    <div class="right monthly-cell">
                      <div class="new-goal">
                        <div class="new-goal-main">
                          <input
                            type="text"
                            inputmode="decimal"
                            class="amount"
                            :class="{ hot: isEdited(category) }"
                            :value="fmt(draftFor(category))"
                            :aria-label="`New goal per month for ${catName(category) || 'this what-if row'}`"
                            :disabled="isOff(category)"
                            title="Per month — does math: +200, 1200/12 — Enter to apply"
                            @change="onAmountChange(category, $event)"
                            @focus="selectAll"
                            @keydown.enter="blurOnEnter"
                          >
                          <button
                            class="shape-btn"
                            :class="{ drafted: Boolean(targetDraftFor(category)) }"
                            :title="shapeButtonTitle(category)"
                            :aria-label="`Reshape the target for ${catName(category) || 'this what-if row'}`"
                            :disabled="isOff(category)"
                            @click.stop="targetEditor?.categoryId === category.id ? closeTargetEditor() : openTargetEditor(category)"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                          </button>
                        </div>
                        <div v-if="newShapeCaption(category)" class="new-goal-shape">{{ newShapeCaption(category) }}</div>
                      </div>
                      <button
                        v-if="isCustom(category)"
                        class="mini-act"
                        title="Remove this what-if row"
                        @click="discardCustomRow(category.id)"
                      >✕</button>
                      <button
                        v-else
                        class="mini-act"
                        :class="{ ghosted: !isEdited(category) }"
                        :title="`Back to YNAB's ${rawTargetLabel(category)}`"
                        :tabindex="isEdited(category) ? 0 : -1"
                        @click="structure.clearTarget(category.id)"
                      >↺</button>
                      <button
                        class="mini-act trash-act"
                        title="Remove from this plan (goes to Trash)"
                        @click="trashRow(section, group, category)"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                      </button>
                      <div
                        v-if="targetEditor && targetEditor.categoryId === category.id"
                        class="target-pop"
                        role="dialog"
                        :aria-label="`Target for ${catName(category) || 'this what-if row'}`"
                        @click.stop
                        @keydown.escape.stop.prevent="closeTargetEditor"
                      >
                        <label class="tp-field">Amount
                          <input
                            id="target-amount-input"
                            v-model="targetEditor.amount"
                            type="text"
                            inputmode="decimal"
                            placeholder="$"
                            title="Does math: 600/12, +25"
                            :disabled="targetEditor.cadence === 'none' || targetEditor.cadence === 'custom'"
                            @keydown.enter.prevent="saveTargetDraft"
                          >
                        </label>
                        <label class="tp-field">Cadence
                          <select v-model="targetEditor.cadence">
                            <option value="monthly">Monthly</option>
                            <option value="weekly">Weekly</option>
                            <option value="yearly">Yearly</option>
                            <option value="bydate">By date</option>
                            <option value="none">No target</option>
                            <option v-if="targetEditor.customLabel" value="custom" disabled>{{ targetEditor.customLabel }}</option>
                          </select>
                        </label>
                        <label v-if="targetEditor.cadence === 'bydate'" class="tp-field">Target date
                          <input v-model="targetEditor.date" type="date">
                        </label>
                        <div v-if="['monthly', 'weekly', 'yearly'].includes(targetEditor.cadence)" class="tp-field">
                          <span class="tp-label">Style</span>
                          <div class="tp-pills">
                            <button
                              class="tp-pill"
                              :class="{ on: targetEditor.needs === 'aside' }"
                              title="Needs the full amount again every period"
                              @click="targetEditor.needs = targetEditor.needs === 'aside' ? null : 'aside'"
                            >Set aside another</button>
                            <button
                              class="tp-pill"
                              :class="{ on: targetEditor.needs === 'refill' }"
                              title="Tops the balance back up to the target"
                              @click="targetEditor.needs = targetEditor.needs === 'refill' ? null : 'refill'"
                            >Refill up to</button>
                          </div>
                        </div>
                        <div v-if="targetEditor.cadence === 'custom'" class="tp-hint">
                          YNAB's API can't write this target shape — convert it below (or pick another cadence) to make it syncable.
                        </div>
                        <div v-if="editorConvertible && editorMonthly" class="tp-convert">
                          <span>≈ {{ fmt(editorMonthly) }} / month</span>
                          <button class="tp-convert-btn" @click="convertToMonthly">Convert to monthly {{ fmt(editorMonthly) }}</button>
                        </div>
                        <div class="tp-actions">
                          <button class="tp-save" :disabled="!editorSavable" @click="saveTargetDraft">Save target</button>
                          <button class="tp-remove" @click="removeTargetDraft">Remove target</button>
                          <button class="tp-cancel" @click="closeTargetEditor">Cancel</button>
                        </div>
                      </div>
                    </div>
                    <div class="right"><span :class="pillClass(effectiveDelta(category))">{{ effectiveDelta(category) !== 0 ? fmtDelta(effectiveDelta(category)) : '—' }}</span></div>
                  </div>

                  <div v-if="!forceOpen && section.detail" class="add-cat-row">
                    <button class="add-cat" @click="onAddRow(section, group)">+ Add a category</button>
                  </div>
                </template>
              </template>

              <div v-if="!forceOpen && section.detail" class="add-group-row">
                <button class="add-group" @click="structure.addGroup(section.planId)">+ New group in {{ section.planName }}</button>
              </div>
            </template>
          </template>

          <div v-if="!isMock && !forceOpen" class="add-budget-row">
            <button v-if="!newBudget.open" class="add-group" @click="newBudget.open = true">+ New plan</button>
            <template v-else>
              <input
                v-model="newBudget.name"
                type="text"
                class="add-budget-name"
                maxlength="80"
                placeholder="Plan name (🌱 Fresh Start)"
                aria-label="New plan name"
                @keyup.enter="createBudget"
                @keyup.escape="newBudget.open = false"
              >
              <select v-model="newBudget.currency" class="add-budget-cur" aria-label="Currency">
                <option v-for="c in CURRENCIES" :key="c.code" :value="c.code">{{ c.label }}</option>
              </select>
              <button class="rec-create" :disabled="newBudget.busy || !newBudget.name.trim()" @click="createBudget">
                {{ newBudget.busy ? 'Creating…' : 'Create' }}
              </button>
              <button class="add-budget-cancel" :disabled="newBudget.busy" @click="newBudget.open = false">Cancel</button>
              <span v-if="newBudget.error" class="add-budget-err">{{ newBudget.error }}</span>
            </template>
          </div>

          <p v-if="!loading && hasAnyDetail && !visibleCategories.length" class="table-note">
            No categories in the selected plans this month.
          </p>
          <p v-else-if="!anyMatch && (filterActive || chip !== 'All')" class="table-note">
            <template v-if="filterActive">No categories match “{{ filter.trim() }}”.</template>
            <template v-else-if="chip === 'Edited'">No edited rows yet — type a new goal and it'll show up here.</template>
            <template v-else>No excluded rows — untick a category to leave it out of the math.</template>
          </p>
        </section>

        <PageFooter class="desk-foot" />
      </template>
    </main>

    <!-- Sync to YNAB — compare → review → push → done -->
    <div v-if="syncStep" class="sync-overlay" @click="closeSync">
      <div class="sync-card" role="dialog" aria-modal="true" :aria-label="canPush ? 'Sync to YNAB' : 'Tinkrr Diff'" @click.stop>
        <div class="sync-head">
          <div class="sync-title">{{ canPush ? 'Sync to YNAB' : 'Tinkrr Diff' }}</div>
          <span class="sync-month">{{ monthFull }}</span>
          <button v-if="syncStep !== 'push' || syncError" class="sync-x" title="Close" @click="closeSync">✕</button>
        </div>

        <div v-if="syncStep === 'compare'" class="sync-compare">
          <div class="sync-compare-title">{{ canPush ? 'Comparing your draft to YNAB…' : 'Collecting your changes…' }}</div>
          <div class="sync-compare-sub">{{ canPush ? 'Pulling the live plan and preparing a diff — nothing is written yet.' : 'A read-only diff of everything you changed — nothing is ever written.' }}</div>
        </div>

        <template v-else-if="syncStep === 'review'">
          <p v-if="canPush" class="sync-lede">
            Here's <b>every action</b> this sync would take, grouped by type. Untick anything
            you don't want — unticked actions stay a local draft. Nothing is written until you
            confirm below.
          </p>
          <p v-else class="sync-lede">
            Everything you've changed this month, grouped the way a sync would apply it.
            Once YNAB is connected with a working token, this exact list becomes pushable.
          </p>
          <div class="sync-groups">
            <div v-for="g in syncGroupRows" :key="g.kind" class="sync-group">
              <label class="sync-group-head">
                <input
                  type="checkbox"
                  :checked="g.rows.every(a => a.blocked || selOn(a.aid))"
                  :aria-label="`Toggle all ${g.name} actions`"
                  @change="toggleSyncGroup(g)"
                >
                <span class="sync-group-name">{{ g.name }}</span>
                <span class="sync-count">{{ g.rows.length }}</span>
                <span class="sync-hint">{{ g.hint }}</span>
              </label>
              <label
                v-for="a in g.rows"
                :key="a.aid"
                class="sync-row"
                :class="{ off: !effectiveOn(a), locked: a.blocked }"
                :title="a.blocked ? 'This plan isn\u2019t linked to YNAB yet — link or merge it below to push' : undefined"
              >
                <input
                  type="checkbox"
                  :checked="effectiveOn(a)"
                  :disabled="a.blocked || Boolean(blockedBy(a))"
                  :title="blockedBy(a) ? blockTitle(a) : ''"
                  :aria-label="a.title"
                  @change="toggleSyncAction(a)"
                >
                <div class="sync-row-main">
                  <div class="sync-row-title">{{ a.title }}</div>
                  <div class="sync-row-detail">{{ a.detail }}</div>
                </div>
              </label>
            </div>
          </div>
          <div v-if="canPush && syncLinkable.length" class="sync-link">
            <div v-for="row in syncLinkable" :key="row.planId" class="sync-link-row">
              <div class="sync-link-copy">
                <b>“{{ row.name }}”</b> is a hand-built plan with
                {{ row.count }} {{ row.count === 1 ? 'change' : 'changes' }} —
                link it to an empty YNAB plan, or merge it into a synced one —
                either way this review will push the changes in. Merging moves its
                groups and rows and removes the empty shell.
              </div>
              <template v-if="linkTargets.length || mergeTargets.length">
                <select v-model="linkChoice[row.planId]" class="sync-link-select" aria-label="Destination for this plan">
                  <option value="" disabled>Pick a destination…</option>
                  <optgroup v-if="linkTargets.length" label="Link to an empty YNAB plan">
                    <option v-for="plan in linkTargets" :key="plan.id" :value="`link:${plan.id}`">{{ plan.name }}</option>
                  </optgroup>
                  <optgroup v-if="mergeTargets.length" label="Merge into a synced plan">
                    <option v-for="plan in mergeTargets" :key="plan.id" :value="`merge:${plan.id}`">{{ plan.name }}</option>
                  </optgroup>
                </select>
                <button
                  class="y-btn-outline"
                  :disabled="!linkChoice[row.planId] || linkBusy === row.planId"
                  @click="linkManualSource(row.planId)"
                >{{ linkBusy === row.planId ? 'Working…' : linkChoice[row.planId]?.startsWith('merge:') ? 'Merge' : 'Link' }}</button>
              </template>
              <span v-else class="sync-link-none">
                No destination yet — YNAB's API can't create plans, so make an
                empty one over there, then check again here.
              </span>
              <a class="sync-link-ynab" href="https://app.ynab.com" target="_blank" rel="noopener">Open YNAB ↗</a>
              <button
                class="y-btn-secondary sync-link-refresh"
                :disabled="linkRefreshing"
                title="Re-check YNAB for new plans"
                @click="refreshLinkTargets"
              >{{ linkRefreshing ? 'Checking…' : '↻ Check again' }}</button>
            </div>
            <div v-if="linkError" class="sync-link-err">{{ linkError }}</div>
          </div>

          <div v-if="syncNotes.length" class="sync-notes">
            <b>Good to know:</b> {{ syncNotes.join(' · ') }}
          </div>
          <div v-if="canPush" class="sync-foot">
            <span class="sync-summary">{{ pickedCount }} of {{ syncActions.length }} actions selected · unticked stay a local draft</span>
            <button class="y-btn-secondary" @click="closeSync">Cancel</button>
            <button class="y-btn" :disabled="!pickedCount" @click="doSync">
              {{ pickedCount ? `Sync ${pickedCount} ${pickedCount === 1 ? 'action' : 'actions'} to YNAB` : 'Nothing selected' }}
            </button>
          </div>
          <div v-else class="sync-foot">
            <span class="sync-summary">
              {{ syncActions.length }} {{ syncActions.length === 1 ? 'change' : 'changes' }} ·
              save a YNAB token and run a sync on the <NuxtLink to="/account">Account page</NuxtLink> to make this pushable
            </span>
            <button class="y-btn-secondary" @click="closeSync">Close</button>
          </div>
        </template>

        <template v-else-if="syncStep === 'push'">
          <p class="sync-lede">Pushing to YNAB — one API call per action, gently (200 requests/hour limit).</p>
          <div class="push-list">
            <div v-for="r in pushRows" :key="r.aid" class="push-row">
              <span class="push-glyph" :class="r.st">{{ pushGlyph(r.st) }}</span>
              <span class="push-title">{{ r.title }}</span>
              <span class="push-status">{{ pushStatus(r.st) }}</span>
            </div>
          </div>
          <div v-if="syncError" class="sync-error" role="alert">{{ syncError }}</div>
        </template>

        <div v-else-if="syncStep === 'done'" class="sync-done">
          <div class="done-badge">✓</div>
          <div class="done-title">Synced {{ syncedCount }} {{ syncedCount === 1 ? 'action' : 'actions' }} to YNAB</div>
          <div class="done-sub">
            YNAB now matches your draft. Anything you left unticked is still here as a local
            draft — sync it any time.<template v-if="mockRun"> (Sample data — nothing was written.)</template>
          </div>
          <button class="y-btn done-btn" @click="closeSync">Done</button>
        </div>
      </div>
    </div>

    <SideRail storage-key="ynabrr:sandbox-panel" phone="sheet">
      <template #bar>
        <div class="phone-bar">
          <div class="phone-bar-main">
            <div class="phone-bar-label">Remaining</div>
            <div class="phone-bar-num" :class="{ neg: remaining < 0 }">{{ fmt(remaining) }}</div>
          </div>
          <div class="phone-bar-hint">
            <template v-if="changeCount">{{ changeCount }} {{ changeCount === 1 ? 'edit' : 'edits' }}<br></template>
            tap for the draft
          </div>
          <button
            class="phone-bar-sync"
            :disabled="!syncActions.length"
            @click.stop="openSync"
          >{{ canPush ? 'Sync' : 'Diff' }}<template v-if="syncActions.length"> · {{ syncActions.length }}</template></button>
        </div>
      </template>
      <div class="rail-head">{{ monthName }}'s scenario</div>

      <div class="scen">
        <div class="scen-row">
          <span class="scen-label">Income</span>
          <input
            type="text"
            inputmode="decimal"
            class="scen-income"
            :value="fmt(income)"
            aria-label="What-if income for this month"
            title="Edit to try a what-if income"
            @change="onIncomeChange"
            @focus="selectAll"
            @keydown.enter="blurOnEnter"
          >
        </div>
        <div class="scen-row">
          <span class="scen-label">Required · {{ includedCount }} of {{ goalCount }} categories</span>
          <b class="scen-val">{{ fmt(requiredTotal) }}</b>
        </div>
        <div class="scen-total">
          <span class="scen-total-label">Remaining</span>
          <span class="scen-total-val" :class="{ neg: remaining < 0 }">{{ fmt(remaining) }}</span>
        </div>
        <div class="scen-sub">
          {{ scenarioActive ? `was ${fmt(remainingBase)} before this draft` : 'income minus required' }}
        </div>
      </div>

      <div class="rail-sec">
        <button class="changes-toggle" :aria-expanded="changesOpen" @click="changesOpen = !changesOpen">
          <span class="changes-label"><span class="chev" :class="{ open: changesOpen }">▸</span>Draft changes</span>
          <span class="count" :class="{ live: changeCount > 0 }">{{ changeCount }}</span>
        </button>

        <div v-if="changeCount > 0 && !changesOpen" class="changes-summary">
          required {{ fmtDelta(totalDelta) }} · remaining {{ fmt(remaining) }}
        </div>

        <template v-if="changesOpen">
          <div v-if="changeCount > 0" class="changes-list">
            <div v-if="incomeDelta !== 0" class="change">
              <div class="change-main">
                <div class="change-name">Income</div>
                <div class="change-detail">{{ fmt(incomeLive) }} → {{ fmt(income) }}</div>
              </div>
              <span :class="pillClass(-incomeDelta)">{{ fmtDelta(incomeDelta) }}</span>
              <button class="undo" :title="`Reset to YNAB's ${fmt(incomeLive)}`" @click="clearDraft(INCOME_KEY)">↺</button>
            </div>
            <div v-for="category in changes" :key="category.id" class="change">
              <div class="change-main">
                <div class="change-name"><template v-if="multiPlan">{{ planNameByCategory.get(category.id) }} · </template>{{ catName(category) || 'What-if row' }}</div>
                <div class="change-detail">
                  <template v-if="isCustom(category)">added · {{ targetDraftFor(category) ? targetDraftLabel(targetDraftFor(category)!) : fmt(draftFor(category)) }}</template>
                  <template v-else>{{ rawTargetLabel(category) }} → {{ targetDraftFor(category) ? targetDraftLabel(targetDraftFor(category)!) : fmt(draftFor(category)) }}</template>
                </div>
              </div>
              <span :class="pillClass(deltaFor(category))">{{ deltaFor(category) !== 0 ? fmtDelta(deltaFor(category)) : '—' }}</span>
              <button
                v-if="isCustom(category)"
                class="undo"
                title="Remove this what-if row"
                @click="discardCustomRow(category.id)"
              >✕</button>
              <button
                v-else
                class="undo"
                :title="`Back to YNAB's ${rawTargetLabel(category)}`"
                @click="structure.clearTarget(category.id)"
              >↺</button>
            </div>
            <div v-for="category in excluded" :key="`off-${category.id}`" class="change">
              <div class="change-main">
                <div class="change-name"><template v-if="multiPlan">{{ planNameByCategory.get(category.id) }} · </template>{{ catName(category) || 'What-if row' }}</div>
                <div class="change-detail">
                  <template v-if="isCustom(category)">what-if row excluded</template>
                  <template v-else>excluded · goal {{ fmt(rawGoalMonthly(category)) }}</template>
                </div>
              </div>
              <span v-if="!isCustom(category)" :class="pillClass(effectiveDelta(category))">{{ fmtDelta(effectiveDelta(category)) }}</span>
              <button class="undo" title="Include again" @click="setDisabled(category.id, false)">↺</button>
            </div>
            <div class="rail-note">Saved in this browser only — nothing is sent to YNAB.</div>
          </div>
          <div v-else class="rail-empty">
            No edits yet. Type a new goal or untick a category and it'll show up here.
          </div>
        </template>
      </div>

      <div class="rail-sec rail-actions">
        <button class="y-btn-secondary full" @click="resetEverything">Reset all</button>
        <div class="two-up">
          <button class="y-btn-secondary" title="Restore a scenario from an exported CSV" @click="importCsv">
            {{ imported ? 'Imported ✓' : 'Import CSV' }}
          </button>
          <button class="y-btn-secondary" :disabled="!hasAnyDetail" @click="exportCsv">Export CSV</button>
        </div>
        <button
          v-if="canPush"
          class="y-btn full"
          :class="{ 'sync-idle': !syncActions.length }"
          :disabled="!syncActions.length"
          :title="syncActions.length ? 'Review every change before anything is written' : 'No differences with YNAB — tinker away'"
          @click="openSync"
        >
          {{ syncActions.length ? `Sync to YNAB · ${syncActions.length} ${syncActions.length === 1 ? 'action' : 'actions'}` : 'Sync to YNAB' }}
        </button>
        <button
          v-else
          class="y-btn-outline full"
          :disabled="!syncActions.length"
          :title="syncActions.length ? 'See exactly what you changed — connect YNAB on the Account page to push it' : 'No changes yet — tinker away'"
          @click="openSync"
        >
          {{ syncActions.length ? `Tinkrr Diff · ${syncActions.length} ${syncActions.length === 1 ? 'change' : 'changes'}` : 'Tinkrr Diff' }}
        </button>
      </div>
    </SideRail>
    <PageFooter phone />
  </div>
</template>

<style scoped>
.wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: flex-start;
}

.page {
  flex: 1;
  min-width: 0;
  padding: 22px 28px 60px;
  line-height: 1.45;
}

/* ---- Header ---- */
.top {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.hero {
  padding: 7px 18px;
  border-radius: 12px;
  text-align: center;
  background: var(--ok-strong-bg);
  color: var(--ok-strong);
}
.hero.neg { background: #f6d5cd; color: var(--danger-dark); }
.hero-num { font-size: 20px; font-weight: 800; line-height: 1.1; }
.hero-sub { font-size: 11px; font-weight: 700; opacity: 0.75; }

.head-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.filter {
  width: 170px;
  padding: 8px 12px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-sm);
  background: var(--bg-card);
  font-size: 13px;
}
.filter:focus { border-color: var(--teal); outline: none; }
.help-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1.5px solid var(--border-input);
  background: var(--bg-card);
  color: var(--fg-subtle);
  font-weight: 800;
  cursor: pointer;
}
.help-btn:hover { border-color: var(--teal); color: var(--teal-dark); }

/* ---- Help ---- */
.help {
  margin-top: 16px;
  background: var(--teal-bg);
  border: 1.5px solid var(--teal-border);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.help-copy { font-size: 13.5px; line-height: 1.55; color: #3c4a46; }
.help-copy code { background: var(--bg-card); padding: 1px 5px; border-radius: 4px; }
.help .y-btn-outline { flex: none; }

.warn-banner { margin-top: 16px; }
.warn-banner .b { font-weight: 700; }
.y-dot.idle { background: var(--fg-faint); }

.empty-state { margin-top: 16px; }
.empty-state h2 { font-size: 16px; }
.empty-state p { margin: 8px 0 0; }
.loading-note { margin-top: 20px; }

/* ---- Chips ---- */
.chips { margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  padding: 6px 14px;
  border-radius: var(--r-pill);
  font-size: 12.5px;
  font-weight: 800;
  cursor: pointer;
  border: 1.5px solid var(--border-input);
  background: var(--bg-card);
  color: var(--fg-muted);
}
.chip.on { border-color: var(--teal); background: var(--teal); color: #fff; }

/* ---- Cards ---- */
.card {
  margin-top: 14px;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-card);
}
.table-card { overflow-x: auto; }
.table-card.pop-open { overflow-x: visible; } /* the target popover must escape the scroll clip */

/* ---- Trash ---- */
.trash-title {
  padding: 10px 18px 8px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.7px;
  text-transform: uppercase;
  color: var(--fg-subtle);
}
.trash-empty { padding: 6px 18px 14px; font-size: 13px; color: var(--fg-faint); }
.trash-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  border-top: 1px solid var(--border-hair);
}
.trash-info { min-width: 0; flex: 1; }
.trash-name { font-weight: 700; font-size: 14px; }
.trash-origin { font-size: 12px; color: var(--fg-subtle); }
.slim { padding: 7px 14px; font-size: 12px; }

/* ---- Table grid ---- */
.grid {
  display: grid;
  grid-template-columns: minmax(150px, 1.4fr) minmax(110px, 1fr) minmax(140px, 150px) minmax(90px, 110px);
  gap: 0 12px;
  align-items: center;
  padding: 10px 18px;
  min-width: 560px;
}
.right { text-align: right; }
.strong { font-weight: 800; font-size: 14px; }
.strong.g { font-size: 13.5px; }
.strong.sm { font-size: 13px; }
.soft { font-size: 12.5px; color: var(--fg-subtle); }
.soft.hint { font-weight: 600; font-size: 12px; }

.head-row {
  border-bottom: 1.5px solid var(--border-soft);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.7px;
  text-transform: uppercase;
  color: var(--fg-subtle);
}
.teal-head { color: var(--teal-dark); }
.head-hint { font-weight: 600; text-transform: none; letter-spacing: 0; }

.plan-row {
  background: #efe9dc;
  border-bottom: 1.5px solid var(--border);
  cursor: pointer;
}
.plan-empty {
  padding: 8px 18px 10px;
  font-size: 12.5px;
  color: var(--fg-faint);
  border-bottom: 1px solid var(--border-hair);
}
.group-row {
  padding: 9px 18px;
  background: #f7f2e9;
  border-bottom: 1px solid var(--border-soft);
  cursor: pointer;
}
.drop-into { box-shadow: inset 0 0 0 2px var(--teal); }

.cell-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.chev {
  display: inline-block;
  color: var(--border-strong);
  transition: transform 0.15s;
  font-size: 12px;
  flex: none;
}
.chev.open { transform: rotate(90deg); }
.check { width: 15px; height: 15px; accent-color: var(--teal); flex: none; }

.row { border-bottom: 1px solid var(--border-hair); background: var(--bg-card); }
.row.edited { background: #f3faf8; }
.row.off { opacity: 0.45; background: #fcfaf5; }
.row.drop-before { box-shadow: inset 0 2.5px 0 var(--teal); }
.row.lifting { opacity: 0.35; }

.drag {
  cursor: grab;
  color: #c9c2b2;
  font-size: 13px;
  flex: none;
  user-select: none;
}
.name-text {
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.name-text.struck { text-decoration: line-through; }
.name-text.renamed {
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-color: var(--teal-border);
  text-underline-offset: 3px;
}
.pen {
  border: none;
  background: none;
  cursor: pointer;
  padding: 0;
  width: 16px;
  color: var(--border-input);
  display: grid;
  place-items: center;
  flex: none;
}
.pen:hover { color: var(--teal-dark); }
.rename-input {
  border-radius: 6px;
  background: var(--bg-input);
  padding: 3px 8px;
  font-size: 13px;
  font-weight: 700;
  min-width: 0;
  width: 170px;
}
.rename-input.dashed { border: 1px dashed var(--border-strong); }
.rename-input.active { border: 1.5px solid var(--teal); }
.rename-input:focus { outline: none; border-color: var(--teal); }

.goal-cell { min-width: 0; color: var(--fg-muted); display: flex; flex-direction: column; gap: 1px; }
.goal-raw { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.goal-approx { font-size: 11px; color: var(--fg-faint); font-weight: 600; white-space: nowrap; }

/* ---- New goal cell + target editor ---- */
.new-goal { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; min-width: 0; }
.new-goal-main { display: flex; align-items: center; gap: 4px; }
.new-goal-shape { font-size: 11px; color: var(--teal-dark); font-weight: 700; white-space: nowrap; }
.shape-btn {
  flex: none;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1.5px solid transparent;
  border-radius: var(--r-xs);
  background: none;
  padding: 0;
  color: var(--border-input);
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
}
.shape-btn:hover:not(:disabled), .shape-btn:focus-visible { color: var(--teal-dark); border-color: var(--border-input); }
.shape-btn.drafted { color: var(--teal-dark); }
.shape-btn:disabled { opacity: 0.35; cursor: default; }
.row:hover .shape-btn:not(:disabled) { color: var(--teal); }

.target-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  text-align: left;
  z-index: 40;
  width: 280px;
  background: var(--bg-card);
  border: 1.5px solid var(--border-input);
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(43, 42, 38, 0.14);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--fg-subtle);
}
.tp-label { display: block; }
.tp-field input, .tp-field select {
  padding: 7px 10px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-xs);
  font-size: 13px;
  font-weight: 700;
  background: var(--bg-input);
  color: var(--fg);
  text-transform: none;
  letter-spacing: normal;
}
.tp-field input:focus, .tp-field select:focus { border-color: var(--teal); outline: none; }
.tp-field input:disabled { background: var(--bg-sunk); color: var(--fg-subtle); }
.tp-pills { display: flex; gap: 6px; }
.tp-pill {
  flex: 1;
  padding: 5px 8px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-pill);
  background: var(--bg-card);
  font-size: 11px;
  font-weight: 700;
  color: var(--fg-muted);
  cursor: pointer;
  white-space: nowrap;
}
.tp-pill.on { border-color: var(--teal); background: var(--teal-badge); color: var(--teal-dark); }
.tp-hint { font-size: 11.5px; color: var(--fg-muted); background: var(--note-bg); border: 1px solid var(--note-border); border-radius: var(--r-xs); padding: 7px 9px; line-height: 1.45; }
.tp-convert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--fg-muted);
  background: var(--teal-bg);
  border: 1px solid var(--teal-border);
  border-radius: var(--r-xs);
  padding: 7px 9px;
}
.tp-convert-btn {
  border: 1.5px solid var(--teal);
  border-radius: var(--r-pill);
  background: var(--bg-card);
  color: var(--teal-dark);
  font-weight: 800;
  font-size: 11px;
  padding: 3px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.tp-convert-btn:hover { background: var(--teal-badge); }
.tp-actions { display: flex; align-items: center; gap: 10px; }
.tp-save {
  padding: 7px 14px;
  border: none;
  border-radius: var(--r-sm);
  background: var(--teal);
  color: #fff;
  font-weight: 800;
  font-size: 12.5px;
  cursor: pointer;
}
.tp-save:hover:not(:disabled) { background: var(--teal-dark); }
.tp-save:disabled { opacity: 0.5; cursor: default; }
.tp-remove {
  border: none;
  background: none;
  color: var(--danger);
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.tp-cancel {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--fg-subtle);
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}

.monthly-cell { display: flex; align-items: center; gap: 6px; justify-content: flex-end; position: relative; }
.amount {
  width: 104px;
  text-align: right;
  padding: 6px 9px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-xs);
  font-size: 13px;
  font-weight: 700;
  background: var(--bg-input);
}
.amount.hot { border-color: var(--teal); }
.amount:disabled { color: var(--fg-faint); }
.amount:focus { border-color: var(--teal); outline: none; }
.mini-act {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  width: 18px;
  color: var(--teal);
  display: grid;
  place-items: center;
  flex: none;
}
.mini-act.ghosted { visibility: hidden; }
.trash-act { color: #c9c2b2; }
.trash-act:hover { color: var(--danger); }

.pill {
  display: inline-block;
  padding: 3px 9px;
  border-radius: var(--r-pill);
  font-weight: 800;
  font-size: 12px;
  white-space: nowrap;
}
.pill-good { background: var(--ok-bg); color: var(--ok); }
.pill-bad { background: var(--danger-bg); color: var(--danger); }
.pill-zero { color: var(--fg-faint); font-size: 13px; }

.add-cat-row { padding: 7px 18px 9px 44px; border-bottom: 1px solid var(--border-hair); }
.add-cat {
  border: none;
  background: none;
  color: var(--teal);
  font-weight: 700;
  font-size: 12.5px;
  cursor: pointer;
  padding: 2px 0;
}
.add-group-row { padding: 9px 18px 11px; border-bottom: 1.5px solid var(--border-soft); background: #fcfaf5; }
.add-group {
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--r-sm);
  background: none;
  color: var(--fg-muted);
  font-weight: 700;
  font-size: 12.5px;
  cursor: pointer;
  padding: 6px 14px;
}
.add-group:hover { border-color: var(--teal); color: var(--teal-dark); }

.table-note { padding: 14px 18px; margin: 0; font-size: 13px; color: var(--fg-faint); }

/* ---- + New budget (bottom of the table, beside its add-category cousins) ---- */
.add-budget-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 18px 12px;
  border-top: 1.5px solid var(--border-soft);
  background: #fcfaf5;
}
.add-budget-name {
  flex: 1;
  min-width: 180px;
  max-width: 300px;
  padding: 7px 11px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-sm);
  font-size: 13px;
  background: var(--bg-input);
}
.add-budget-name:focus { border-color: var(--teal); outline: none; }
.add-budget-cur {
  padding: 7px 9px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-sm);
  font-size: 13px;
  font-weight: 600;
  background: var(--bg-input);
}
.rec-create {
  padding: 7px 16px;
  border: none;
  border-radius: var(--r-sm);
  background: var(--teal);
  color: #fff;
  font-weight: 800;
  font-size: 12.5px;
  cursor: pointer;
}
.rec-create:hover:not(:disabled) { background: var(--teal-dark); }
.rec-create:disabled { opacity: 0.5; cursor: default; }
.add-budget-cancel {
  border: none;
  background: none;
  color: var(--fg-subtle);
  font-weight: 700;
  font-size: 12.5px;
  cursor: pointer;
  padding: 0;
}
.add-budget-err { font-size: 12px; color: var(--danger); }

/* ---- Rail ---- */
.rail-head {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--fg-subtle);
}

.scen { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; }
.scen-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.scen-label { font-size: 13px; font-weight: 700; color: var(--fg-muted); }
.scen-val { font-size: 13.5px; }
.scen-income {
  width: 110px;
  text-align: right;
  padding: 6px 9px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-xs);
  font-size: 13.5px;
  font-weight: 800;
  background: var(--bg-input);
}
.scen-income:focus { border-color: var(--teal); outline: none; }
.scen-total {
  border-top: 1.5px dashed var(--border);
  padding-top: 10px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.scen-total-label { font-weight: 800; font-size: 13.5px; }
.scen-total-val { font-weight: 800; font-size: 19px; color: var(--ok); }
.scen-total-val.neg { color: var(--danger); }
.scen-sub { font-size: 11.5px; color: var(--fg-faint); }

.rail-sec { margin-top: 22px; border-top: 1.5px solid var(--border-soft); padding-top: 16px; }

.changes-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  gap: 8px;
}
.changes-label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--fg-subtle);
}
.changes-label .chev { font-size: 11px; }
.count {
  min-width: 20px;
  height: 20px;
  border-radius: var(--r-pill);
  display: grid;
  place-items: center;
  font-size: 11.5px;
  font-weight: 800;
  padding: 0 6px;
  background: var(--neutral-bg);
  color: var(--fg-faint);
}
.count.live { background: var(--teal); color: #fff; }

.changes-summary {
  margin-top: 10px;
  font-size: 12px;
  color: var(--fg-muted);
  background: var(--bg-app);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-sm);
  padding: 8px 10px;
}
.changes-list { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.change {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  background: var(--bg-app);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-sm);
  padding: 7px 10px;
}
.change-main { min-width: 0; flex: 1; }
.change-name { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.change-detail { color: var(--fg-subtle); font-size: 11.5px; }
.undo {
  border: none;
  background: none;
  color: var(--teal);
  cursor: pointer;
  font-size: 14px;
  padding: 0;
  flex: none;
}
.rail-note { font-size: 11px; color: var(--fg-faint); }
.rail-empty { margin-top: 10px; font-size: 12.5px; color: var(--fg-faint); line-height: 1.5; }

.rail-actions { display: flex; flex-direction: column; gap: 8px; }
.full { width: 100%; }
.two-up { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.two-up .y-btn-secondary { padding: 9px 8px; }
.sync-idle { opacity: 0.45; }

/* ---- Sync to YNAB modal ---- */
.sync-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(43, 42, 38, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.sync-card {
  width: 620px;
  max-width: 100%;
  max-height: 88vh;
  overflow: auto;
  background: var(--bg-card);
  border-radius: var(--r-panel);
  padding: 24px;
  box-shadow: 0 12px 40px rgba(43, 42, 38, 0.3);
}
.sync-head { display: flex; align-items: baseline; gap: 10px; }
.sync-title { font-weight: 800; font-size: 17px; }
.sync-row.locked { cursor: default; }
.sync-row.locked .sync-row-title::after {
  content: ' 🔒';
  font-size: 11px;
}

.sync-link {
  margin-top: 12px;
  background: var(--teal-bg);
  border: 1.5px solid var(--teal-border);
  border-radius: 9px;
  padding: 10px 13px;
}
.sync-link-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sync-link-copy { font-size: 12.5px; line-height: 1.5; color: #3c4a46; flex: 1 1 100%; }
.sync-link-select {
  flex: 1;
  min-width: 170px;
  max-width: 260px;
  padding: 7px 9px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-sm);
  background: var(--bg-card);
  font-size: 12.5px;
  font-weight: 700;
}
.sync-link-none { font-size: 12px; color: var(--fg-subtle); }
.sync-link-ynab { font-size: 12.5px; font-weight: 800; white-space: nowrap; }
.sync-link-refresh { padding: 6px 12px; font-size: 12px; }
.sync-link-err { margin-top: 6px; font-size: 12px; color: var(--danger); }
.sync-month { font-size: 12px; color: var(--fg-faint); }
.sync-x {
  margin-left: auto;
  border: none;
  background: none;
  color: var(--fg-subtle);
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
  padding: 0;
}

.sync-compare { padding: 40px 0; text-align: center; }
.sync-compare-title { font-weight: 800; font-size: 15px; }
.sync-compare-sub { margin-top: 6px; font-size: 12.5px; color: var(--fg-subtle); }

.sync-lede { margin: 8px 0 0; font-size: 12.5px; color: var(--fg-muted); line-height: 1.5; }

.sync-groups { margin-top: 14px; display: flex; flex-direction: column; gap: 14px; }
.sync-group { border: 1.5px solid var(--border-soft); border-radius: 11px; overflow: hidden; }
.sync-group-head {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 14px;
  background: #f7f2e9;
  cursor: pointer;
}
.sync-group-head input,
.sync-row input { width: 15px; height: 15px; accent-color: var(--teal); flex: none; }
.sync-group-name { font-weight: 800; font-size: 13px; }
.sync-count {
  min-width: 18px;
  height: 18px;
  border-radius: var(--r-pill);
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 800;
  padding: 0 6px;
  background: var(--teal);
  color: #fff;
}
.sync-hint { margin-left: auto; font-size: 11.5px; color: var(--fg-subtle); }
.sync-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-top: 1px solid var(--border-hair);
  cursor: pointer;
  background: var(--bg-card);
}
.sync-row.off { background: #fcfaf5; opacity: 0.55; }
.sync-row-main { min-width: 0; flex: 1; }
.sync-row-title { font-weight: 700; font-size: 13px; }
.sync-row-detail { font-size: 11.5px; color: var(--fg-subtle); }

.sync-notes {
  margin-top: 12px;
  background: var(--note-bg);
  border: 1px solid var(--note-border);
  border-radius: var(--r-field);
  padding: 10px 13px;
  font-size: 12px;
  color: var(--fg-muted);
  line-height: 1.5;
}

.sync-foot { margin-top: 16px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sync-summary { font-size: 12.5px; color: var(--fg-subtle); margin-right: auto; }

.push-list { margin-top: 14px; display: flex; flex-direction: column; gap: 7px; }
.push-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  background: var(--bg-app);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-sm);
  padding: 8px 12px;
}
.push-glyph {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 800;
  flex: none;
  background: var(--neutral-bg);
  color: var(--fg-faint);
}
.push-glyph.doing { background: var(--teal-badge); color: var(--teal-dark); }
.push-glyph.done { background: var(--ok-bg); color: var(--ok); }
.push-glyph.failed { background: var(--danger-bg); color: var(--danger); }
.push-title { font-weight: 700; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.push-status { margin-left: auto; font-size: 11.5px; color: var(--fg-subtle); white-space: nowrap; }

.sync-error {
  margin-top: 14px;
  background: var(--danger-bg);
  border: 1.5px solid var(--danger);
  border-radius: var(--r-field);
  padding: 10px 13px;
  font-size: 12.5px;
  color: var(--danger-dark);
  line-height: 1.5;
}

.sync-done { padding: 26px 0 10px; text-align: center; }
.done-badge {
  width: 52px;
  height: 52px;
  margin: 0 auto;
  border-radius: 50%;
  background: var(--ok-bg);
  color: var(--ok);
  display: grid;
  place-items: center;
  font-size: 24px;
  font-weight: 800;
}
.done-title { margin-top: 12px; font-weight: 800; font-size: 16px; }
.done-sub { margin-top: 6px; font-size: 12.5px; color: var(--fg-subtle); line-height: 1.5; max-width: 420px; margin-left: auto; margin-right: auto; }
.done-btn { margin-top: 18px; padding: 10px 26px; }

@media (max-width: 900px) {
  .page { padding: 20px 16px 48px; }
  .head-right { margin-left: 0; }
}

/* ---- phone: sticky summary bar (SideRail sheet mode) ---- */
.phone-bar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; }
.phone-bar-main { display: flex; flex-direction: column; gap: 1px; }
.phone-bar-label { font-size: 10.5px; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; color: var(--fg-subtle); }
.phone-bar-num { font-size: 18px; font-weight: 800; color: var(--teal-dark); font-variant-numeric: tabular-nums; }
.phone-bar-num.neg { color: var(--danger); }
.phone-bar-hint { flex: 1; font-size: 12px; line-height: 1.3; color: var(--fg-muted); }
.phone-bar-sync {
  min-height: 44px;
  padding: 0 16px;
  border: none;
  border-radius: var(--r-sm);
  background: var(--teal);
  color: #fff;
  font-size: 13.5px;
  font-weight: 800;
  cursor: pointer;
}
.phone-bar-sync:disabled { opacity: 0.45; cursor: default; }

/* ==== phone (<760px): two-line rows, sheet for the scenario panel ==== */
@media (max-width: 759px) {
  .wrap { flex-direction: column; align-items: stretch; }
  .page { padding: 12px 14px 0; }
  .desk-foot { display: none; }
  .wrap > .foot.phone-only { padding-bottom: 120px; }
  .top { gap: 10px; }
  .hero { flex: 1; padding: 6px 12px; }
  .head-right { width: 100%; }
  .filter { flex: 1; width: auto; min-height: 44px; }
  .help-btn { width: 44px; height: 44px; }
  .chips { flex-wrap: wrap; }
  .chip { min-height: 36px; }
  .table-card { overflow-x: hidden; }
  .grid {
    min-width: 0;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: "name name" "goal input" "goal diff";
    gap: 2px 10px;
    padding: 10px 12px;
    align-items: center;
  }
  .grid > :nth-child(1) { grid-area: name; min-width: 0; }
  .grid > :nth-child(2) { grid-area: goal; align-self: start; padding-top: 6px; }
  .grid > :nth-child(3) { grid-area: input; }
  .grid > :nth-child(4) { grid-area: diff; text-align: right; }
  .head-row > :nth-child(2), .head-row > :nth-child(4) { display: none; }
  .head-row { grid-template-areas: "name input"; grid-template-columns: minmax(0, 1fr) auto; }
  .plan-row, .group-row { grid-template-areas: "name name" "goal input" "goal diff"; }
  .group-row > :nth-child(3), .plan-row > :nth-child(3) { font-size: 14px; }
  .row .goal-cell .goal-raw::before { content: "YNAB · "; }
  .goal-cell { flex-direction: row; flex-wrap: wrap; gap: 0 6px; font-size: 12px; }
  .goal-raw { white-space: normal; overflow: visible; }
  .cell-name .check { width: 22px; height: 22px; }
  .drag { width: 24px; }
  .amount { width: 96px; min-height: 40px; font-size: 16px; }
  .shape-btn, .mini-act { width: 36px; height: 36px; }
  .mini-act { font-size: 16px; }
  .target-pop { width: min(300px, calc(100vw - 40px)); }
  .add-budget-row { flex-wrap: wrap; }
  .add-budget-name { flex: 1 1 100%; min-height: 44px; }
  .add-cat, .add-group { min-height: 44px; }
  /* sync review as a bottom sheet */
  .sync-overlay { align-items: flex-end; padding: 0; }
  .sync-card {
    width: 100%;
    max-height: 92vh;
    max-height: 92dvh;
    border-radius: var(--r-panel) var(--r-panel) 0 0;
    padding: 18px 16px calc(18px + env(safe-area-inset-bottom));
    -webkit-overflow-scrolling: touch;
  }
}
</style>
