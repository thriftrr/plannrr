<script setup lang="ts">
// Desktop: sidebar + page (+ the page's own right rail), centre column scrolls.
// Phone (<760px): top bar + document scroll + fixed tab bar; the sidebar is
// hidden by CSS so nothing flashes before hydration.
useViewport()
</script>

<template>
  <div class="app">
    <AppSidebar />
    <MobileTopBar />
    <slot />
    <MobileTabBar />
    <FeedbackFab />
  </div>
</template>

<style scoped>
/* align-items: start lets the sidebar's position: sticky engage — a stretched
   flex child can't stick. The centre column is the only thing that scrolls. */
.app {
  display: flex;
  align-items: flex-start;
  min-height: 100vh;
  min-height: 100dvh;
}
/* Tablets: an inline panel (SideRail under 1100px) is 100% wide, so let the
   row wrap and it lands beneath the page instead of beside it. */
@media (max-width: 1099px) {
  .app { flex-wrap: wrap; }
}
@media (max-width: 759px) {
  .app {
    flex-direction: column;
    align-items: stretch;
    padding-bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
  }
}
</style>
