<script setup lang="ts">
// Function title templates can't ride in nuxt.config (not serializable) —
// they live here so "Tinkrr" becomes "Tinkrr · Plannrr" on every page.
useHead({
  titleTemplate: (title?: string | null) =>
    title && title !== 'Plannrr' ? `${title} · Plannrr` : 'Plannrr'
})
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>
