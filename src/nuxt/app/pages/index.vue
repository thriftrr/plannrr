<script setup lang="ts">
import type { PlanSummary } from '#shared/types/ynab'

const { data, error, status } = await useFetch<{ plans: PlanSummary[] }>('/api/ynab/plans', {
  lazy: true
})
</script>

<template>
  <main class="page">
    <h1>YNABRR</h1>
    <p class="tagline">A YNAB planning companion.</p>

    <section class="status">
      <p v-if="status === 'pending'">Checking YNAB connection…</p>
      <template v-else-if="error">
        <h2>Not connected</h2>
        <p>
          Copy <code>.env.example</code> to <code>.env</code> and set
          <code>NUXT_YNAB_PERSONAL_ACCESS_TOKEN</code> with a token from
          <a href="https://app.ynab.com/settings/developer">YNAB → Account Settings → Developer</a>.
        </p>
      </template>
      <template v-else>
        <h2>Connected</h2>
        <ul>
          <li v-for="plan in data?.plans" :key="plan.id">{{ plan.name }}</li>
        </ul>
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

.tagline {
  color: #666;
}

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
