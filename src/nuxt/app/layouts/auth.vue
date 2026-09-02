<template>
  <div class="auth">
    <slot />
  </div>
</template>

<style scoped>
.auth {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
@media (max-width: 759px) {
  .auth { padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); justify-content: flex-start; padding-top: max(32px, env(safe-area-inset-top)); }
}
</style>
