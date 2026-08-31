<script setup lang="ts">
const email = ref('')
const sending = ref(false)
const sent = ref(false)
const error = ref('')
const devLink = ref('')

async function submit () {
  if (!email.value.trim() || sending.value) return
  sending.value = true
  error.value = ''
  try {
    const data = await $fetch<{ ok: boolean, devLink?: string }>('/api/auth/login', {
      method: 'POST',
      body: { email: email.value }
    })
    sent.value = true
    devLink.value = data.devLink ?? ''
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    error.value = err.data?.statusMessage ?? 'Something went wrong — try again.'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <main class="page">
    <h1><NuxtLink to="/">YNABRR</NuxtLink> <span class="crumb">/ Sign in</span></h1>

    <section v-if="!sent" class="card">
      <h2>Sign in with email</h2>
      <p>No password — we'll email you a sign-in link that's valid for 15 minutes.</p>
      <form @submit.prevent="submit">
        <input
          v-model="email"
          type="email"
          required
          placeholder="you@example.com"
          aria-label="Email address"
          autocomplete="email"
        >
        <button class="primary" type="submit" :disabled="sending">
          {{ sending ? 'Sending…' : 'Email me a link' }}
        </button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </section>

    <section v-else class="card">
      <h2>Check your email</h2>
      <p>We sent a sign-in link to <strong>{{ email }}</strong>. It expires in 15 minutes.</p>
      <p v-if="devLink" class="dev-link">
        Dev mode — the link is also in the server console:<br>
        <a :href="devLink">{{ devLink }}</a>
      </p>
    </section>
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

h1 { margin: 0 0 1.5rem; }
h1 a { color: inherit; text-decoration: none; }
.crumb { color: #999; font-weight: 400; }

.card {
  padding: 1.25rem 1.5rem;
  border: 1px solid #ddd;
  border-radius: 8px;
}

.card h2 { margin: 0 0 0.5rem; }
.card p { margin: 0.4rem 0; color: #555; }

form {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
  flex-wrap: wrap;
}

input {
  flex: 1;
  min-width: 12rem;
  padding: 0.5rem 0.7rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  font: inherit;
}

.primary {
  padding: 0.5rem 1rem;
  border: 1px solid #4a7dff;
  border-radius: 6px;
  background: #4a7dff;
  color: #fff;
  font: inherit;
  cursor: pointer;
}

.primary:disabled { opacity: 0.6; }

.error { color: #b3261e; }

.dev-link {
  padding: 0.6rem 0.8rem;
  background: #fff8e1;
  border: 1px solid #ffe08a;
  border-radius: 6px;
  font-size: 0.85rem;
  word-break: break-all;
}
</style>
