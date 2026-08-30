export type CustomRowMeta = { planId: string, groupName: string, name: string }

// Draft "what if" state for the sandbox, persisted to localStorage per scope
// (the page scopes by month): budgeted amounts in milliunits keyed by category
// id, which rows are excluded from the math, and hypothetical "what-if" rows
// the user inserted (their amounts live in the drafts map under the row id).
// Nothing here talks to YNAB — drafts stay local until an explicit sync.
export function useSandboxDrafts (scope: () => string) {
  const drafts = ref<Record<string, number>>({})
  const disabled = ref<Record<string, boolean>>({})
  const custom = ref<Record<string, CustomRowMeta>>({})

  const draftsKey = computed(() => `ynabrr:sandbox:${scope()}`)
  const disabledKey = computed(() => `ynabrr:sandbox:off:${scope()}`)
  const customKey = computed(() => `ynabrr:sandbox:add:${scope()}`)

  const readMap = <T>(key: string): T => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}')
    } catch {
      return {} as T
    }
  }

  watch(draftsKey, () => {
    if (!import.meta.client) return
    drafts.value = readMap(draftsKey.value)
    disabled.value = readMap(disabledKey.value)
    custom.value = readMap(customKey.value)
  }, { immediate: true })

  const persist = (key: string, value: Record<string, unknown>) => {
    if (!import.meta.client) return
    try {
      if (Object.keys(value).length === 0) {
        localStorage.removeItem(key)
      } else {
        localStorage.setItem(key, JSON.stringify(value))
      }
    } catch {
      // Private windows or blocked storage — state just won't persist.
    }
  }

  watch(drafts, value => persist(draftsKey.value, value), { deep: true })
  watch(disabled, value => persist(disabledKey.value, value), { deep: true })
  watch(custom, value => persist(customKey.value, value), { deep: true })

  const setDraft = (categoryId: string, milliunits: number, baseline: number) => {
    if (milliunits === baseline) {
      delete drafts.value[categoryId]
    } else {
      drafts.value[categoryId] = milliunits
    }
  }

  const clearDraft = (categoryId: string) => {
    delete drafts.value[categoryId]
  }

  const setDisabled = (categoryId: string, off: boolean) => {
    if (off) {
      disabled.value[categoryId] = true
    } else {
      delete disabled.value[categoryId]
    }
  }

  const addCustom = (planId: string, groupName: string) => {
    const id = `custom-${Math.random().toString(36).slice(2, 10)}`
    custom.value[id] = { planId, groupName, name: '' }
    return id
  }

  const renameCustom = (id: string, name: string) => {
    const row = custom.value[id]
    if (row) row.name = name
  }

  const removeCustom = (id: string) => {
    delete custom.value[id]
    delete drafts.value[id]
    delete disabled.value[id]
  }

  const resetAll = () => {
    drafts.value = {}
    disabled.value = {}
    custom.value = {}
  }

  return { drafts, disabled, custom, setDraft, clearDraft, setDisabled, addCustom, renameCustom, removeCustom, resetAll }
}
