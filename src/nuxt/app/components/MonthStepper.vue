<script setup lang="ts">
// The design's ‹ Month Year › stepper, bounded by the months that actually
// exist in the selected budgets. `options` is sorted newest-first.
const props = defineProps<{ modelValue: string, options: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const index = computed(() => props.options.indexOf(props.modelValue))
// options are newest-first: "older" moves down the list, "newer" up
const older = computed(() => props.options[index.value + 1] ?? null)
const newer = computed(() => index.value > 0 ? props.options[index.value - 1]! : null)

const label = computed(() => {
  if (!props.modelValue) return '—'
  const [y, m] = props.modelValue.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
})
</script>

<template>
  <div class="stepper">
    <button :disabled="!older" aria-label="Previous month" @click="older && emit('update:modelValue', older)">‹</button>
    <div class="label">{{ label }}</div>
    <button :disabled="!newer" aria-label="Next month" @click="newer && emit('update:modelValue', newer)">›</button>
  </div>
</template>

<style scoped>
.stepper { display: flex; align-items: center; gap: 6px; }
.stepper button {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1.5px solid var(--border-input);
  background: var(--bg-card);
  color: var(--teal);
  font-size: 15px;
  cursor: pointer;
}
.stepper button:disabled { color: var(--border-input); cursor: default; }
.label { font-weight: 800; font-size: 19px; padding: 0 6px; white-space: nowrap; }
@media (max-width: 759px) {
  .stepper { width: 100%; justify-content: space-between; }
  .stepper button { width: 44px; height: 44px; font-size: 18px; }
  .label { flex: 1; text-align: center; }
}
</style>
