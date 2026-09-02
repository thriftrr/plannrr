<script setup lang="ts">
import type { PlanSummary } from '#shared/types/ynab'

// The design's "N budgets ▼" popover with checkbox rows. Selection semantics
// live in usePlanSelection; this is just the face.
const props = defineProps<{
  plans: PlanSummary[]
  selected: string[]
  label: string
  caption: string
  note: string
}>()
const emit = defineEmits<{ toggle: [id: string] }>()

const open = ref(false)
const root = ref<HTMLElement>()

function onDocClick (e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="root" class="picker">
    <button class="face" :class="{ open }" @click="open = !open">
      <span class="face-label">{{ label }}</span>
      <span class="caret">▼</span>
    </button>
    <div v-if="open" class="pop">
      <div class="caption">{{ caption }}</div>
      <label v-for="p in plans" :key="p.id" class="row">
        <input
          type="checkbox"
          :checked="selected.includes(p.id)"
          :disabled="selected.includes(p.id) && selected.length === 1"
          @change="emit('toggle', p.id)"
        >
        <span class="name">{{ p.name }}</span>
      </label>
      <div class="note">{{ note }}</div>
    </div>
  </div>
</template>

<style scoped>
.picker { position: relative; }
.face {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 240px;
  padding: 8px 12px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-sm);
  background: var(--bg-card);
  font-size: 13.5px;
  font-weight: 700;
  color: var(--fg);
  cursor: pointer;
}
.face.open { border-color: var(--teal); }
.face-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.caret { font-size: 10px; color: var(--fg-subtle); }

.pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  width: 230px;
  background: var(--bg-card);
  border: 1.5px solid var(--border-input);
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(43, 42, 38, 0.14);
  padding: 8px;
}
.caption {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.7px;
  text-transform: uppercase;
  color: var(--fg-subtle);
  padding: 4px 8px 6px;
}
.row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 8px;
  border-radius: var(--r-xs);
  cursor: pointer;
}
.row:hover { background: var(--bg-app); }
.row input { width: 15px; height: 15px; accent-color: var(--teal); }
.name { font-size: 13.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.note { padding: 6px 8px 2px; font-size: 11px; color: var(--fg-faint); }
@media (max-width: 759px) {
  .face { max-width: none; min-height: 44px; }
  .pop {
    position: fixed;
    top: auto;
    left: 0;
    right: 0;
    bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
    width: auto;
    max-height: 70vh;
    max-height: 70dvh;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
    z-index: 45;
    border-radius: 14px 14px 0 0;
    padding: 10px 12px 14px;
    box-shadow: 0 -6px 24px rgba(43, 42, 38, 0.18);
  }
  .row { min-height: 44px; }
  .row input[type="checkbox"] { width: 20px; height: 20px; }
}
</style>
