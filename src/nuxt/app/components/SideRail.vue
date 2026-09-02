<script setup lang="ts">
// The design's right-hand panel: white, hairline left border, collapsible to a
// 64px rail, persisted per page. Pinned full-height — only the centre column
// of the page scrolls (its own overflow scrolls internally when taller).
// With `expandable`, a second toggle widens it to ~2/5 of the page for a
// roomier working layout; the slot receives { wide } to adapt its content.
// Under 1100px the pinned rail can't exist. `phone` picks what replaces it:
//   'inline' (default) — the panel renders as a block after the page content
//   'sheet'            — a sticky bar (the `bar` slot) above the tab bar opens
//                        the panel as a bottom sheet
const props = defineProps<{ storageKey: string, expandable?: boolean, phone?: 'inline' | 'sheet' }>()
const { isTablet } = useViewport()
// The server always renders the desktop rail; switching branches during
// hydration would leave Vue patching a mismatched <aside>. So the compact
// modes engage only after mount — the desktop rail is hidden by CSS under
// 1100px anyway, so nothing flashes.
const mounted = ref(false)
onMounted(() => { mounted.value = true })
const compact = computed(() => mounted.value && isTablet.value)
const sheetOpen = ref(false)
watch(compact, (value) => { if (!value) sheetOpen.value = false })
function onSheetKey (event: KeyboardEvent) { if (event.key === 'Escape') sheetOpen.value = false }
watch(sheetOpen, (open) => {
  if (!import.meta.client) return
  document.body.style.overflow = open ? 'hidden' : ''
  if (open) window.addEventListener('keydown', onSheetKey)
  else window.removeEventListener('keydown', onSheetKey)
})
onUnmounted(() => { if (import.meta.client) { document.body.style.overflow = ''; window.removeEventListener('keydown', onSheetKey) } })

type Mode = 'closed' | 'open' | 'wide'
const mode = ref<Mode>('open')

function persist () {
  try {
    localStorage.setItem(props.storageKey, mode.value)
  } catch { /* session-only is fine */ }
}

function toggleOpen () {
  mode.value = mode.value === 'closed' ? 'open' : 'closed'
  persist()
}

function toggleWide () {
  mode.value = mode.value === 'wide' ? 'open' : 'wide'
  persist()
}

onMounted(() => {
  try {
    const stored = localStorage.getItem(props.storageKey)
    if (stored === 'closed' || stored === 'open') mode.value = stored
    else if (stored === 'wide') mode.value = props.expandable ? 'wide' : 'open'
  } catch { /* default open */ }
})
</script>

<template>
  <template v-if="compact && phone === 'sheet'">
    <div class="sheet-bar" role="button" tabindex="0" aria-label="Open the panel" @click="sheetOpen = true" @keydown.enter="sheetOpen = true">
      <slot name="bar" />
    </div>
    <Teleport to="body">
      <div v-if="sheetOpen" class="sheet-overlay" @click="sheetOpen = false">
        <div class="sheet" role="dialog" aria-modal="true" @click.stop>
          <button class="sheet-handle" aria-label="Close the panel" @click="sheetOpen = false"><span /></button>
          <div class="sheet-body"><slot :wide="false" /></div>
        </div>
      </div>
    </Teleport>
  </template>
  <aside v-else-if="compact" class="rail inline">
    <div class="body"><slot :wide="false" /></div>
  </aside>
  <aside v-else class="rail" :class="{ closed: mode === 'closed', wide: mode === 'wide' }">
    <div class="rail-tools">
      <button
        class="toggle"
        :title="mode === 'closed' ? 'Expand panel' : 'Collapse panel'"
        :aria-expanded="mode !== 'closed'"
        @click="toggleOpen"
      >
        {{ mode === 'closed' ? '«' : '»' }}
      </button>
      <button
        v-if="expandable && mode !== 'closed'"
        class="toggle"
        :title="mode === 'wide' ? 'Back to the narrow panel' : 'Widen the panel'"
        :aria-pressed="mode === 'wide'"
        @click="toggleWide"
      >
        {{ mode === 'wide' ? '⤡' : '⤢' }}
      </button>
    </div>
    <div v-if="mode !== 'closed'" class="body">
      <slot :wide="mode === 'wide'" />
    </div>
  </aside>
</template>

<style scoped>
.rail {
  flex: none;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  width: 300px;
  background: var(--bg-card);
  border-left: 1.5px solid var(--border);
  padding: 22px 20px 40px;
  transition: width 0.18s;
}
.rail.closed { width: 64px; }
.rail.wide { width: clamp(380px, 40vw, 640px); }

.rail-tools { display: flex; gap: 6px; }

.toggle {
  width: 26px;
  height: 26px;
  border: 1.5px solid var(--border);
  border-radius: var(--r-xs);
  background: var(--bg-card);
  color: var(--fg-subtle);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  flex: none;
  display: grid;
  place-items: center;
  padding: 0;
}
.toggle:hover { border-color: var(--teal); color: var(--teal-dark); }

.body { margin-top: 14px; }

/* ---- under 1100px: inline block or bottom sheet ---- */
.rail.inline {
  position: static;
  height: auto;
  width: 100%;
  border-left: none;
  border-top: 1.5px solid var(--border);
  padding: 18px 20px 28px;
}
.rail.inline .body { margin-top: 0; }
@media (max-width: 1099px) {
  .rail:not(.inline) { display: none; }
}
.sheet-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
  z-index: 29;
  background: var(--bg-card);
  border-top: 1.5px solid var(--border);
  box-shadow: 0 -3px 14px rgba(43, 42, 38, 0.06);
  cursor: pointer;
}
@media (min-width: 760px) { .sheet-bar { bottom: 0; } }
</style>

<style>
/* Teleported to <body>, so unscoped. */
.sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: rgba(43, 42, 38, 0.35);
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  max-height: 86vh;
  max-height: 86dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -6px 24px rgba(43, 42, 38, 0.18);
  padding-bottom: env(safe-area-inset-bottom);
}
.sheet-handle {
  flex: none;
  width: 100%;
  height: 28px;
  border: none;
  background: none;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.sheet-handle span { width: 40px; height: 4px; border-radius: 999px; background: var(--border-input); }
.sheet-body { overflow: auto; -webkit-overflow-scrolling: touch; padding: 0 18px 24px; }
</style>
