<template>
  <div class="app">
    <AppSidebar />
    <slot />
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
}
</style>
