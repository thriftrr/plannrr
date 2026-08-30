// Draft "what if" budgeted amounts (milliunits) keyed by category id.
// Persisted to localStorage per plan+month so tinkering survives reloads.
// Nothing here talks to YNAB — drafts stay local until an explicit sync.
export function useSandboxDrafts (scope: () => string) {
  const drafts = ref<Record<string, number>>({})

  const storageKey = computed(() => `ynabrr:sandbox:${scope()}`)

  watch(storageKey, (key) => {
    if (!import.meta.client) return
    try {
      drafts.value = JSON.parse(localStorage.getItem(key) ?? '{}')
    } catch {
      drafts.value = {}
    }
  }, { immediate: true })

  watch(drafts, (value) => {
    if (!import.meta.client) return
    try {
      if (Object.keys(value).length === 0) {
        localStorage.removeItem(storageKey.value)
      } else {
        localStorage.setItem(storageKey.value, JSON.stringify(value))
      }
    } catch {
      // Private windows or blocked storage — drafts just won't persist.
    }
  }, { deep: true })

  const setDraft = (categoryId: string, milliunits: number, liveBudgeted: number) => {
    if (milliunits === liveBudgeted) {
      delete drafts.value[categoryId]
    } else {
      drafts.value[categoryId] = milliunits
    }
  }

  const clearDraft = (categoryId: string) => {
    delete drafts.value[categoryId]
  }

  const resetAll = () => {
    drafts.value = {}
  }

  return { drafts, setDraft, clearDraft, resetAll }
}
