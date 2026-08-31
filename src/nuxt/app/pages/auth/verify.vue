<script setup lang="ts">
const route = useRoute()
const { refresh } = useAuth()
const state = ref<'working' | 'error'>('working')
const message = ref('')

onMounted(async () => {
  const token = route.query.token
  if (typeof token !== 'string' || !token) {
    state.value = 'error'
    message.value = 'This link is missing its token.'
    return
  }
  try {
    await $fetch('/api/auth/verify', { method: 'POST', body: { token } })
    await refresh()
    await navigateTo('/sandbox')
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    state.value = 'error'
    message.value = err.data?.statusMessage ?? 'Could not verify this link.'
  }
})
</script>

<template>
  <main class="page">
    <h1><NuxtLink to="/">YNABRR</NuxtLink></h1>
    <p v-if="state === 'working'">Signing you in…</p>
    <template v-else>
      <p class="error">{{ message }}</p>
      <p><NuxtLink to="/login">Request a new link</NuxtLink></p>
    </template>
  </main>
</template>

<style scoped>
.page {
  max-width: 26rem;
  margin: 0 auto;
  padding: 3rem 1.5rem;
  font-family: system-ui, sans-serif;
  line-height: 1.5;
}

h1 { margin: 0 0 1rem; }
h1 a { color: inherit; text-decoration: none; }
.error { color: #b3261e; }
</style>
