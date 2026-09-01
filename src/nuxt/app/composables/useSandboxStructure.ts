// Tinkrr's local structure overlay — renames, trash, custom groups, and the
// drag-layout that lets categories live in another group or budget. All of it
// is a lens over YNAB truth, stored once globally (NOT per month: moving
// "Groceries" into another group should hold across months, while amounts
// stay per-month in useSandboxDrafts). Nothing here is ever written to YNAB.

export interface TrashEntry {
  planId: string
  planName: string
  group: string
  name: string
  goal: number // milliunits, snapshot at trash time
  custom?: boolean
}

export interface CustomGroupDef { planId: string, name: string }

// A drafted target (YNAB goal) for one category. Mirrors what the API can
// actually write: recurring weekly/monthly/yearly, by-date, or removal.
// `target: null` means "remove the target"; frequency and targetDate are
// mutually exclusive; needsWholeAmount is NEED-only (true = "Set aside
// another", false = "Refill up to", null/undefined = leave as-is).
export interface TargetDraft {
  target: number | null
  frequency?: 'monthly' | 'weekly' | 'yearly'
  targetDate?: string
  needsWholeAmount?: boolean | null
}

interface StructureState {
  renames: Record<string, string>
  trash: Record<string, TrashEntry>
  customGroups: Record<string, CustomGroupDef>
  // `${planId}::${groupKey}` -> ordered category ids claimed by that group.
  // groupKey is the real group name, or a custom group's id.
  layout: Record<string, string[]>
  // categoryId -> drafted target; a lens over the goal until it's pushed.
  targets: Record<string, TargetDraft>
}

const STORAGE_KEY = 'ynabrr:sandbox:structure'

const empty = (): StructureState => ({ renames: {}, trash: {}, customGroups: {}, layout: {}, targets: {} })

export function useSandboxStructure () {
  const state = ref<StructureState>(empty())

  if (import.meta.client) {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      if (raw && typeof raw === 'object') {
        state.value = { ...empty(), ...raw }
      }
    } catch { /* corrupted or blocked storage — start from YNAB truth */ }
  }

  watch(state, (value) => {
    if (!import.meta.client) return
    try {
      const bare = !Object.keys(value.renames).length && !Object.keys(value.trash).length
        && !Object.keys(value.customGroups).length && !Object.keys(value.layout).length
        && !Object.keys(value.targets).length
      if (bare) localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    } catch { /* storage blocked — the overlay just won't persist */ }
  }, { deep: true })

  const renames = computed(() => state.value.renames)
  const trash = computed(() => state.value.trash)
  const customGroups = computed(() => state.value.customGroups)
  const layout = computed(() => state.value.layout)
  const targets = computed(() => state.value.targets)

  const setTarget = (id: string, draft: TargetDraft) => {
    state.value.targets[id] = draft
  }

  const clearTarget = (id: string) => {
    delete state.value.targets[id]
  }

  const setRename = (id: string, name: string) => {
    const trimmed = name.trim()
    if (trimmed) state.value.renames[id] = trimmed
    else delete state.value.renames[id]
  }

  const trashCategory = (id: string, entry: TrashEntry) => {
    state.value.trash[id] = entry
  }

  const restoreCategory = (id: string) => {
    delete state.value.trash[id]
  }

  // Full scrub — used by delete-forever on what-if rows.
  const scrubCategory = (id: string) => {
    delete state.value.trash[id]
    delete state.value.renames[id]
    delete state.value.targets[id]
    for (const ids of Object.values(state.value.layout)) {
      const i = ids.indexOf(id)
      if (i >= 0) ids.splice(i, 1)
    }
  }

  // Re-homes everything a budget holds locally onto another budget — the
  // client half of "merge a hand-built budget into an existing one". Custom
  // groups, layout claims (custom rows included), and trash origins move;
  // renames/targets/drafts are category-id keyed and follow automatically.
  const mergeInto = (fromPlanId: string, toPlanId: string) => {
    for (const def of Object.values(state.value.customGroups)) {
      if (def.planId === fromPlanId) def.planId = toPlanId
    }
    const nextLayout: Record<string, string[]> = {}
    for (const [key, ids] of Object.entries(state.value.layout)) {
      const [planId, groupKey] = key.split('::', 2)
      nextLayout[planId === fromPlanId ? `${toPlanId}::${groupKey}` : key] = ids
    }
    state.value.layout = nextLayout
    for (const entry of Object.values(state.value.trash)) {
      if (entry.planId === fromPlanId) entry.planId = toPlanId
    }
  }

  const addGroup = (planId: string): string => {
    const existing = Object.values(state.value.customGroups).filter(g => g.planId === planId)
    let n = existing.length + 1
    while (existing.some(g => g.name === `New group ${n}`)) n++
    const key = `cgrp-${Math.random().toString(36).slice(2, 10)}`
    state.value.customGroups[key] = { planId, name: `New group ${n}` }
    return key
  }

  const renameGroup = (key: string, name: string) => {
    const def = state.value.customGroups[key]
    if (def && name.trim()) def.name = name.trim()
  }

  const saveLayout = (entries: Record<string, string[]>) => {
    Object.assign(state.value.layout, entries)
  }

  // ---- Post-sync cleanup ----------------------------------------------------
  // After a successful push, the overlay entries that were written to YNAB
  // come back as refetched truth — their local claims must go, or they'd be
  // applied twice.

  const releaseClaim = (id: string) => {
    for (const ids of Object.values(state.value.layout)) {
      const i = ids.indexOf(id)
      if (i >= 0) ids.splice(i, 1)
    }
  }

  const removeGroup = (key: string) => {
    delete state.value.customGroups[key]
  }

  // A custom group that was created in YNAB gets a real identity: its layout
  // key changes from the cgrp-* key to the group's name, so any UNPUSHED
  // claims into it keep pointing at the (now real) group.
  const renameLayoutKey = (oldKey: string, newKey: string) => {
    const ids = state.value.layout[oldKey]
    if (!ids) return
    delete state.value.layout[oldKey]
    if (ids.length) {
      state.value.layout[newKey] = [...(state.value.layout[newKey] ?? []), ...ids.filter(id => !(state.value.layout[newKey] ?? []).includes(id))]
    }
  }

  const resetStructure = () => {
    state.value = empty()
  }

  return {
    renames, trash, customGroups, layout, targets,
    setTarget, clearTarget,
    setRename, trashCategory, restoreCategory, scrubCategory,
    addGroup, mergeInto, renameGroup, saveLayout, resetStructure,
    releaseClaim, removeGroup, renameLayoutKey
  }
}
