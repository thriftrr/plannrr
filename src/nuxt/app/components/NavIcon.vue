<script setup lang="ts">
import type { IconPath } from '~/utils/nav-items'
defineProps<{ paths: IconPath[], size?: number }>()
</script>

<template>
  <svg :width="size ?? 20" :height="size ?? 20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-for="(p, i) in paths" :key="i">
      <rect v-if="'rect' in p" v-bind="p.rect" />
      <line v-else-if="'line' in p" v-bind="p.line" />
      <circle v-else-if="'circle' in p" v-bind="p.circle" />
      <polyline v-else-if="'polyline' in p" v-bind="p.polyline" />
      <path v-else-if="'path' in p" v-bind="p.path" />
    </template>
  </svg>
</template>
