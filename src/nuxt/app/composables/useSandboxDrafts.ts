// Draft "what if" state for the sandbox, persisted to localStorage per scope
// (the page scopes by month): budgeted amounts in milliunits keyed by category
// id, plus which rows are excluded from the math. Nothing here talks to YNAB —
// drafts stay local until an explicit sync.
export function useSandboxDrafts (scope: () => string) {
  const drafts = ref<Record<string, number>>({})
  const disabled = ref<Record<string, boolean>>({})

  const draftsKey = computed(() => `ynabrr:sandbox:${scope()}`)
  const disabledKey = computed(() => `ynabrr:sandbox:off:${scope()}`)

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

  const resetAll = () => {
    drafts.value = {}
    disabled.value = {}
  }

  return { drafts, disabled, setDraft, clearDraft, setDisabled, resetAll }
}
