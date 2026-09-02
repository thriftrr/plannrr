<script setup lang="ts">
import { DEFAULT_PALETTE, PALETTE_IDS } from '#shared/types/palette'

const { palette } = usePalette()

// Function title templates can't ride in nuxt.config (not serializable) —
// they live here so "Tinkrr" becomes "Tinkrr · Plannrr" on every page.
useHead({
  titleTemplate: (title?: string | null) =>
    title && title !== 'Plannrr' ? `${title} · Plannrr` : 'Plannrr',
  htmlAttrs: {
    'data-palette': computed(() => palette.value === DEFAULT_PALETTE ? undefined : palette.value)
  },
  script: [{
    // Stamps the remembered palette before first paint so a reload never
    // flashes teal. Only known ids are honored.
    key: 'palette-boot',
    innerHTML: `(function(){try{var p=localStorage.getItem('ynabrr:palette');if(p&&${JSON.stringify(PALETTE_IDS)}.indexOf(p)>=0)document.documentElement.setAttribute('data-palette',p)}catch(e){}})()`
  }]
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
