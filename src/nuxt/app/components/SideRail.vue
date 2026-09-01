<script setup lang="ts">
// The design's right-hand panel: white, hairline left border, collapsible to a
// 64px rail, persisted per page. Pinned full-height — only the centre column
// of the page scrolls (its own overflow scrolls internally when taller).
// With `expandable`, a second toggle widens it to ~2/5 of the page for a
// roomier working layout; the slot receives { wide } to adapt its content.
const props = defineProps<{ storageKey: string, expandable?: boolean }>()

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
  <aside class="rail" :class="{ closed: mode === 'closed', wide: mode === 'wide' }">
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

@media (max-width: 1100px) {
  .rail { display: none; }
}
</style>
