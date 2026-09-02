<script setup lang="ts">
// Phone shell, top: wordmark, a feedback button, and the account avatar.
// Shown by CSS under 760px only (see layouts/default.vue).
const { user } = useAuth()
const { avatarUrl, initials } = useAvatar()
const feedbackOpen = useState<boolean>('feedback-open', () => false)
</script>

<template>
  <header class="mtop">
    <NuxtLink to="/" class="mark">
      <img src="/logo-mark-light.svg" alt="" width="26" height="26" class="mark-img">
      Plannrr<span class="mark-dot">.</span>
    </NuxtLink>
    <div class="spacer" />
    <button v-if="user" class="ico" title="Send feedback" aria-label="Send feedback" @click="feedbackOpen = true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 9a4 4 0 0 1 8 0v5a4 4 0 0 1-8 0zM3 13h5M16 13h5M5 7l3 2M19 7l-3 2M5 19l3-2M19 19l-3-2" /></svg>
    </button>
    <NuxtLink v-if="user?.isAdmin" to="/admin/feedback" class="ico" title="Feedback inbox" aria-label="Feedback inbox">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
    </NuxtLink>
    <NuxtLink to="/account" class="avatar-link" :title="user ? user.email : 'Sign in'">
      <img v-if="avatarUrl" :src="avatarUrl" alt="" width="30" height="30" class="avatar">
      <span v-else class="avatar initials">{{ user ? initials : '→' }}</span>
    </NuxtLink>
  </header>
</template>

<style scoped>
.mtop {
  display: none;
  align-items: center;
  gap: 4px;
  height: calc(52px + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 10px 0 14px;
  background: var(--teal-deep);
  color: #fff;
  position: sticky;
  top: 0;
  z-index: 30;
  flex: none;
}
.mark { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 18px; letter-spacing: 0.5px; color: #fff; text-decoration: none; }
.mark-img { display: block; border-radius: 6px; }
.mark-dot { color: var(--nav-accent); }
.spacer { flex: 1; }
.ico {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: none;
  background: none;
  color: var(--nav-fg);
  cursor: pointer;
  text-decoration: none;
}
.avatar-link { width: 44px; height: 44px; display: grid; place-items: center; text-decoration: none; }
.avatar { width: 30px; height: 30px; border-radius: 999px; display: block; object-fit: cover; }
.avatar.initials { display: grid; place-items: center; background: var(--teal-badge); color: var(--teal-dark); font-size: 12px; font-weight: 800; }
@media (max-width: 759px) { .mtop { display: flex; } }
</style>
