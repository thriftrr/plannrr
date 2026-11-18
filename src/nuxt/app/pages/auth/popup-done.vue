<script setup lang="ts">
// Where a popup sign-in lands (see utils/authrr-popup.ts): tells the page
// that's waiting, then closes. Opened from a crafted link instead, it can't
// close itself — then it's an ordinary landing that carries on.
definePageMeta({ layout: 'auth' })
useHead({ title: 'Signing in' })

const route = useRoute()
const next = safeRedirectPath(route.query.next) || '/'
const error = typeof route.query.error === 'string' ? route.query.error : ''
const stuck = ref(false)
const { user, refresh } = useAuth()

onMounted(async () => {
  // Anyone can link here, so "signed in" is only said once the session says
  // so; a crafted link just lands on the sign-in page.
  if (!error) {
    await refresh()
    if (!user.value) return navigateTo('/login', { replace: true })
  }
  announceAuthrrResult(error ? { type: 'error', code: error } : { type: 'signed-in', next })
  window.close()
  // Still here: not a window we opened, so nothing will close it.
  setTimeout(() => {
    if (error) return navigateTo(`/login?${new URLSearchParams({ error })}`, { replace: true })
    stuck.value = true
  }, 400)
})
</script>

<template>
  <main class="wrap">
    <section class="panel" aria-live="polite">
      <p v-if="!stuck" class="y-body">
        Signing you in to Plannrr…
      </p>
      <template v-else>
        <h1>You're signed in</h1>
        <p class="y-body">
          If Plannrr is open in another tab, it's signed in there too — you can close this one.
        </p>
        <NuxtLink :to="next" class="again" replace>
          Continue here
        </NuxtLink>
      </template>
    </section>
  </main>
</template>

<style scoped>
.wrap { width: 400px; max-width: 100%; display: flex; flex-direction: column; align-items: stretch; }

.panel {
  margin-top: 28px;
  width: auto;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-panel);
  padding: 28px;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

h1 { font-size: 18px; }
.panel .y-body { margin: 8px 0 0; }
.again { display: inline-block; margin-top: 14px; font-weight: 700; font-size: 13.5px; }

@media (max-width: 759px) {
  .wrap { width: 100%; }
  .panel { width: 100%; margin-top: 22px; padding: 22px 18px; }
}
</style>
