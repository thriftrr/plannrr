<script setup lang="ts">
// Phone shell, bottom: the four destinations plus Account. Fixed above the
// home indicator; pages pad for it via --tabbar-h on the layout.
import { NAV_ITEMS } from '~/utils/nav-items'
const route = useRoute()
const isActive = (to: string) => route.path === to || route.path.startsWith(to + '/')
</script>

<template>
  <nav class="tabs" aria-label="Main">
    <NuxtLink v-for="item in NAV_ITEMS" :key="item.to" :to="item.to" class="tab" :class="{ on: isActive(item.to) }">
      <NavIcon :paths="item.paths" :size="22" />
      <span>{{ item.short }}</span>
    </NuxtLink>
    <NuxtLink to="/account" class="tab" :class="{ on: isActive('/account') }">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
      <span>Account</span>
    </NuxtLink>
  </nav>
</template>

<style scoped>
.tabs {
  display: none;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  height: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
  padding: 4px 4px env(safe-area-inset-bottom);
  background: var(--bg-card);
  border-top: 1.5px solid var(--border);
}
.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 44px;
  color: var(--fg-subtle);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.2px;
  text-decoration: none;
  border-radius: var(--r-xs);
}
.tab.on { color: var(--teal-dark); font-weight: 800; }
.tab:active { background: var(--bg-app); }
@media (max-width: 759px) { .tabs { display: flex; } }
</style>
