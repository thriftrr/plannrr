<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Sign in' })

const email = ref('')
const sending = ref(false)
const sent = ref(false)
const error = ref('')
const devLink = ref('')

const route = useRoute()
// Landing here from "Delete my account": say so — the bare sign-in form would
// look like nothing happened.
const deleted = computed(() => route.query.deleted === '1')
// Back from Authrr's logout.
const signedOut = computed(() => route.query.signedOut === '1')

// With Authrr configured, accounts live there: this page is one button.
const authrr = useRuntimeConfig().public.authrrIssuer
const signIn = useAuthrrSignIn('/', next => navigateTo(next, { replace: true }))

// A reason code from the callback (shared/utils/authrr-errors.ts), never a
// sentence from the URL.
if (typeof route.query.error === 'string') {
  error.value = authrrErrorMessage(route.query.error)
}

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

function reset () {
  sent.value = false
  devLink.value = ''
}
</script>

<template>
  <main class="wrap">
    <NuxtLink to="/" class="y-wordmark mark">Plannrr<span>.</span></NuxtLink>
    <div class="tagline">A YNAB planning companion</div>

    <!-- Accounts through Authrr: one button, its window does the rest. -->
    <section v-if="authrr" class="panel">
      <p v-if="deleted" class="y-note done" role="status">
        Your account and everything Plannrr held for it have been deleted.
      </p>
      <p v-else-if="signedOut && !error" class="y-note done" role="status">
        You're signed out.
      </p>
      <h1>Sign in</h1>
      <p class="y-body">
        Plannrr uses Authrr for sign-in — one account and passkey for every thriftrr app.
      </p>
      <button class="y-btn send" type="button" :disabled="signIn.waiting.value" @click="signIn.start()">
        {{ signIn.waiting.value ? 'Waiting for Authrr…' : 'Continue with Authrr' }}
      </button>
      <p v-if="signIn.waiting.value" class="y-body waiting">
        Finish signing in in the window that just opened.
        <button class="y-btn-link" type="button" @click="signIn.cancel()">Cancel</button>
      </p>
      <p v-if="error || signIn.error.value" class="y-error err" role="alert">
        {{ error || signIn.error.value }}
      </p>
    </section>

    <section v-else-if="!sent" class="panel">
      <p v-if="deleted" class="y-note done" role="status">
        Your account and everything Plannrr held for it have been deleted.
      </p>
      <h1>Sign in with email</h1>
      <p class="y-body">
        No password — we'll email you a sign-in link that's valid for 15 minutes.
      </p>
      <!-- method="dialog": before hydration attaches the Vue handler, a native
           submit would GET /login and reload the page, wiping the form. A
           dialog-method form outside a <dialog> submits nowhere, and unlike an
           inline onsubmit="return false" it needs no CSP exception. -->
      <form method="dialog" @submit.prevent="submit">
        <input
          v-model="email"
          class="y-input"
          type="email"
          required
          placeholder="you@example.com"
          aria-label="Email address"
          autocomplete="email"
        >
        <button class="y-btn send" type="submit" :disabled="sending">
          {{ sending ? 'Sending…' : 'Email me a link' }}
        </button>
      </form>
      <p v-if="error" class="y-error err" role="alert">{{ error }}</p>
    </section>

    <section v-else class="panel">
      <h1>Check your email 📬</h1>
      <p class="y-body">
        We sent a sign-in link to <b>{{ email }}</b>. It expires in 15 minutes.
      </p>
      <div v-if="devLink" class="y-note dev">
        Dev mode — the link is also in the server console:<br>
        <a :href="devLink" class="dev-url">{{ devLink }}</a>
      </div>
      <button class="y-btn-link back" @click="reset">← Use a different email</button>
    </section>
    <LegalLine />
  </main>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.mark { font-size: 26px; }

.tagline {
  margin-top: 4px;
  font-size: 13.5px;
  color: var(--fg-subtle);
}

.panel {
  margin-top: 28px;
  width: 400px;
  max-width: 100%;
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: var(--r-panel);
  padding: 28px;
  box-shadow: var(--shadow-card);
}

h1 { font-size: 18px; }

.panel p { margin: 8px 0 0; }

form {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.send { padding: 11px 13px; font-size: 14px; margin-top: 18px; width: 100%; }
form .send { margin-top: 0; }

.err { margin-top: 12px; font-size: 13.5px; }

.waiting { font-size: 13px; color: var(--fg-subtle); }

.dev { margin-top: 14px; }
.dev-url { word-break: break-all; font-weight: 700; }

.panel .done { margin: 0 0 16px; }

.back { margin-top: 14px; }

@media (max-width: 759px) {
  .wrap { width: 100%; }
  .panel { width: 100%; margin-top: 22px; padding: 22px 18px; }
  .send { min-height: 44px; }
}
</style>
