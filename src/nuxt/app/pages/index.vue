<script setup lang="ts">
import type { PlanSummary } from '#shared/types/ynab'

const { user, refresh } = useAuth()

type ServerStatus = { mock: boolean, authenticated: boolean, hasPat: boolean, hasEnvPat: boolean }
const serverStatus = ref<ServerStatus | null>(null)
const plans = ref<PlanSummary[]>([])
const pending = ref(true)

onMounted(async () => {
  try {
    await refresh()
    serverStatus.value = await $fetch<ServerStatus>('/api/ynab/status')
    const data = await $fetch<{ plans: PlanSummary[] }>('/api/ynab/plans')
    plans.value = data.plans
  } catch { /* the status box falls through to "get started" */ }
  pending.value = false
})
</script>

<template>
  <main class="page">
    <header class="top">
      <div>
        <h1>YNABRR</h1>
        <p class="tagline">A YNAB planning companion.</p>
      </div>
      <nav class="nav">
        <NuxtLink to="/sandbox">Sandbox</NuxtLink>
        <NuxtLink v-if="user" to="/account">{{ user.email }}</NuxtLink>
        <NuxtLink v-else to="/login" class="cta">Sign in</NuxtLink>
      </nav>
    </header>

    <section class="status">
      <p v-if="pending">Checking connection…</p>
      <template v-else-if="serverStatus?.mock">
        <h2>Sample data mode</h2>
        <p>
          Serving built-in mock budgets — head into the
          <NuxtLink to="/sandbox">sandbox</NuxtLink> and play.
        </p>
      </template>
      <template v-else-if="plans.length">
        <h2>Connected</h2>
        <ul>
          <li v-for="plan in plans" :key="plan.id">{{ plan.name }}</li>
        </ul>
        <p><NuxtLink to="/sandbox">Open the sandbox →</NuxtLink></p>
      </template>
      <template v-else-if="user">
        <h2>Almost there</h2>
        <p>
          You're signed in as <strong>{{ user.email }}</strong>. Head to
          <NuxtLink to="/account">your account</NuxtLink> to import a YNAB export
          zip or save a personal access token — then the sandbox lights up.
        </p>
      </template>
      <template v-else>
        <h2>Get started</h2>
        <p>
          <NuxtLink to="/login">Sign in with your email</NuxtLink> — no password,
          just a magic link. Then import a YNAB export zip or connect your own
          access token.
        </p>
      </template>
    </section>

    <section class="ideas">
      <article>
        <h2><NuxtLink to="/sandbox">Budget sandbox →</NuxtLink></h2>
        <p>
          Pull categories, spending, and goals. Play out scenarios — live off one
          paycheck, send everything else to debt — then sync the plan back to YNAB.
        </p>
      </article>
      <article>
        <h2>Calendar view</h2>
        <p>
          Bills and goal target dates on a calendar, with progress toward
          date-anchored savings goals.
        </p>
      </article>
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 42rem;
  margin: 0 auto;
  padding: 3rem 1.5rem;
  font-family: system-ui, sans-serif;
  line-height: 1.5;
}

.top {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: baseline;
  justify-content: space-between;
}

.tagline {
  color: #666;
}

.nav {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.nav a {
  color: #4a7dff;
  text-decoration: none;
}

.nav a:hover { text-decoration: underline; }

.nav .cta {
  padding: 0.35rem 0.9rem;
  border: 1px solid #4a7dff;
  border-radius: 6px;
  background: #4a7dff;
  color: #fff;
}

.nav .cta:hover { text-decoration: none; opacity: 0.9; }

.status {
  margin: 2rem 0;
  padding: 1rem 1.25rem;
  border: 1px solid #ddd;
  border-radius: 8px;
}

.ideas {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
}

.ideas article {
  padding: 1rem 1.25rem;
  border: 1px solid #ddd;
  border-radius: 8px;
}

h1, h2 {
  margin: 0 0 0.5rem;
}
</style>
