<script setup lang="ts">
const { user, displayName, refresh } = useAuth()
const { format } = useMoney()
const stats = useHomeStats()

type ServerStatus = { mock: boolean, authenticated: boolean, hasPat: boolean, hasEnvPat: boolean }
const serverStatus = ref<ServerStatus | null>(null)
const pending = ref(true)

onMounted(async () => {
  try {
    await refresh()
    serverStatus.value = await $fetch<ServerStatus>('/api/ynab/status')
    await stats.load()
  } catch { /* the banner falls through to "get started" */ }
  pending.value = false
})

// Greets by first name, falling back to the email's local part. Either way,
// and even with nothing to go on, everyone gets the wave.
const greeting = computed(() => {
  if (!user.value) return 'Welcome to Plannrr 👋'
  return displayName.value ? `Welcome back, ${displayName.value} 👋` : 'Welcome back 👋'
})

const planLabel = computed(() => {
  const n = stats.planCount.value
  return n === 1 ? '1 plan' : `${n} plans`
})

const budgetLabel = computed(() => {
  const names = stats.planNames.value
  if (!names.length) return ''
  return names.length === 1 ? names[0]! : `${names.length} plans`
})

// Pills quote real figures, or nothing at all — never a placeholder number.
const leftOverPill = computed(() => {
  const value = stats.leftOver.value
  if (value === null) return null
  return value >= 0
    ? { tone: 'y-pill-ok', text: `${format(value)} left over this month` }
    : { tone: 'y-pill-warn', text: `${format(Math.abs(value))} over budget this month` }
})

const billsPill = computed(() => {
  const n = stats.billsDue.value
  if (n === null || n === 0) return null
  return { tone: 'y-pill-warn', text: `${n} bill${n === 1 ? '' : 's'} due this month` }
})

const paidDownPill = computed(() => {
  const value = stats.paidDown.value
  if (!value) return null
  return { tone: 'y-pill-ok-soft', text: `${format(value)} paid down so far` }
})

const closedPill = computed(() => {
  const closed = stats.debtsClosed.value
  const total = stats.debtsTotal.value
  if (closed === null || !total) return null
  return { tone: 'y-pill-neutral', text: `${closed} of ${total} debts closed` }
})

// ---- First-visit walkthrough ------------------------------------------------
// Four steps to a finished profile. Hidden in sample-data / no-login modes,
// once everything's done, or after "Skip for now" (remembered server-side).
const { palette } = usePalette()
const skipBusy = ref(false)

const setupSteps = computed(() => {
  const u = user.value
  if (!u) return []
  const connected = u.hasPat || stats.planCount.value > 0
  return [
    {
      key: 'photo',
      done: Boolean(u.avatarUrl),
      title: 'Add a profile picture',
      blurb: 'Upload a photo — or skip this one: without an upload we show your Gravatar (the picture tied to your email), or your initials if there isn\'t one.',
      to: '/account#profile',
      cta: 'Upload a photo'
    },
    {
      key: 'name',
      done: Boolean(u.firstName),
      title: 'Tell us your name',
      blurb: 'So the greeting up top can say hi properly.',
      to: '/account#profile',
      cta: 'Add your name'
    },
    {
      key: 'palette',
      done: Boolean(u.palette),
      title: 'Pick a colour palette',
      blurb: 'Seven looks for the whole app. Teal is the house style; the rest are yours to try.',
      to: '/account#palette',
      cta: 'Choose a palette'
    },
    {
      key: 'budget',
      done: connected,
      title: 'Connect your plan',
      blurb: 'Three ways in — pick whichever fits how you use YNAB.',
      to: '/account#ynab-token',
      cta: 'Connect a plan'
    }
  ]
})
const setupDone = computed(() => setupSteps.value.filter(s => s.done).length)
const showSetup = computed(() =>
  Boolean(user.value) && !pending.value && !serverStatus.value?.mock
  && !user.value?.onboardingDismissedAt && setupSteps.value.length > 0
  && setupDone.value < setupSteps.value.length)

async function skipSetup () {
  if (skipBusy.value || !user.value) return
  skipBusy.value = true
  try {
    await $fetch('/api/account/profile', { method: 'PATCH', body: { dismissOnboarding: true } })
    user.value = { ...user.value, onboardingDismissedAt: new Date().toISOString() }
  } catch { /* the card simply shows again next visit */ } finally {
    skipBusy.value = false
  }
}

const icon = {
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'
}
</script>

<template>
  <main class="page">
    <h1>{{ greeting }}</h1>
    <p class="lede">
      Your plan, seen clearly. Tinker with the month, watch your debt melt, and
      sync back to YNAB when you're ready.
    </p>

    <section class="y-banner status">
      <template v-if="pending">
        <span class="y-dot pending" />Checking connection…
      </template>
      <template v-else-if="serverStatus?.mock">
        <span class="y-dot" />
        Sample data mode — serving built-in mock plans.
        <NuxtLink to="/tinkrr" class="b">Open Tinkrr</NuxtLink>
      </template>
      <template v-else-if="stats.planCount.value">
        <span class="y-dot" />
        <span>
          Connected<template v-if="user"> as <b>{{ user.email }}</b></template>
          <template v-if="budgetLabel"> · plan <b>{{ budgetLabel }}</b></template>
          <template v-if="timeAgo(stats.lastSynced.value)"> · debts synced {{ timeAgo(stats.lastSynced.value) }}</template>
        </span>
        <NuxtLink to="/account" class="b">manage sources</NuxtLink>
      </template>
      <template v-else-if="user">
        <span class="y-dot idle" />
        Signed in as <b>{{ user.email }}</b> — no plans yet.
        <NuxtLink to="/account" class="b">Import an export or add a token</NuxtLink>
      </template>
      <template v-else>
        <span class="y-dot idle" />
        <NuxtLink to="/login" class="b">Sign in with your email</NuxtLink>
        — no password, just a magic link.
      </template>
    </section>

    <section v-if="showSetup" class="setup y-card" aria-labelledby="setup-title">
      <div class="setup-head">
        <div>
          <div id="setup-title" class="setup-title">Fill in your profile</div>
          <div class="y-small">A few quick things and Plannrr feels like home. {{ setupDone }} of {{ setupSteps.length }} done.</div>
        </div>
        <div class="setup-meter" :style="{ '--pct': `${(setupDone / setupSteps.length) * 100}%` }" aria-hidden="true"><span /></div>
      </div>
      <ol class="setup-steps">
        <li v-for="(step, i) in setupSteps" :key="step.key" class="setup-step" :class="{ done: step.done }">
          <span class="setup-num">{{ step.done ? '✓' : i + 1 }}</span>
          <div class="setup-body">
            <div class="setup-step-title">{{ step.title }}</div>
            <p class="y-small">{{ step.blurb }}</p>
            <ul v-if="step.key === 'budget' && !step.done" class="setup-ways">
              <li>
                <NuxtLink to="/account#ynab-token"><b>A YNAB access token</b></NuxtLink> — live sync both ways, the best option if you use YNAB every day.
              </li>
              <li>
                <NuxtLink to="/account#sources"><b>A YNAB export zip</b></NuxtLink> — no token needed; a point-in-time copy you refresh by importing again.
              </li>
              <li>
                <NuxtLink to="/tinkrr"><b>Build one by hand in Tinkrr</b></NuxtLink> — no YNAB at all; your currency comes from the profile above.
              </li>
            </ul>
            <NuxtLink v-if="!step.done" :to="step.to" class="y-btn-outline setup-cta">{{ step.cta }}</NuxtLink>
          </div>
        </li>
      </ol>
      <div class="setup-foot">
        <button class="y-btn-link" :disabled="skipBusy" @click="skipSetup">{{ skipBusy ? 'Skipping…' : 'Skip for now' }}</button>
        <span class="y-tiny">You can do all of this on the <NuxtLink to="/account">account page</NuxtLink> any time.</span>
      </div>
    </section>

    <div class="tiles">
      <NuxtLink to="/tinkrr" class="y-tile">
        <svg v-bind="icon"><rect x="3" y="4" width="18" height="16" rx="2.5" /><line x1="3" y1="9.5" x2="21" y2="9.5" /><line x1="3" y1="14.75" x2="21" y2="14.75" /><line x1="14" y1="9.5" x2="14" y2="20" /></svg>
        <div class="y-tile-title">Tinkrr →</div>
        <p>
          Every goal and its monthly cost. Play out scenarios — live off one
          paycheck, send the rest to debt — then sync the plan back.
        </p>
        <span v-if="leftOverPill" class="y-pill" :class="leftOverPill.tone">{{ leftOverPill.text }}</span>
        <span v-else-if="stats.planCount.value" class="y-pill y-pill-neutral">{{ planLabel }} connected</span>
      </NuxtLink>

      <NuxtLink to="/calendrr" class="y-tile">
        <svg v-bind="icon"><rect x="3" y="5" width="18" height="16" rx="2.5" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="2.5" x2="8" y2="6.5" /><line x1="16" y1="2.5" x2="16" y2="6.5" /><circle cx="8.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="12.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" /></svg>
        <div class="y-tile-title">Calendrr →</div>
        <p>
          Bills and goal target dates on a month grid, with progress toward
          date-anchored savings goals.
        </p>
        <span v-if="billsPill" class="y-pill" :class="billsPill.tone">{{ billsPill.text }}</span>
      </NuxtLink>

      <NuxtLink to="/debt-colectrr" class="y-tile">
        <svg v-bind="icon"><polyline points="3,6 8,10 13,14 21,19" /><polyline points="15.5,19 21,19 21,13.5" /></svg>
        <div class="y-tile-title">Debt Colectrr →</div>
        <p>
          Total debt over time, past and projected, with every account's payoff
          progress in one place.
        </p>
        <span v-if="paidDownPill" class="y-pill" :class="paidDownPill.tone">{{ paidDownPill.text }}</span>
      </NuxtLink>

      <NuxtLink to="/remembrr" class="y-tile">
        <svg v-bind="icon"><path d="M5 3h11a3 3 0 0 1 3 3v15H8a3 3 0 0 1-3-3Z" /><path d="M19 17H8a3 3 0 0 0-3 3" /><line x1="9" y1="8" x2="15" y2="8" /></svg>
        <div class="y-tile-title">Remembrr →</div>
        <p>
          The whole history — every debt taken on and paid off, in order, with
          the running total at each step.
        </p>
        <span v-if="closedPill" class="y-pill" :class="closedPill.tone">{{ closedPill.text }}</span>
      </NuxtLink>
    </div>

    <footer class="tip">
      <span class="mug">☕</span>
      <div class="pitch">
        <div class="pitch-title">Is Plannrr saving you money?</div>
        <div class="y-small">It's free and always will be — but if it's earned a coffee, the tip jar's open.</div>
      </div>
      <a href="https://ko-fi.com/tubstrr" target="_blank" rel="noopener" class="kofi">Support tubstrr on Ko-fi →</a>
    </footer>
    <LegalLine />
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  min-width: 0;
  padding: 48px 56px;
  max-width: var(--content-max);
}

h1 { font-size: 30px; }

.lede {
  margin: 8px 0 0;
  font-size: 15px;
  color: var(--fg-muted);
  max-width: 520px;
}

.status { margin-top: 20px; }
.status .b { font-weight: 700; }
.y-dot.idle { background: var(--fg-faint); }
.y-dot.pending { background: var(--teal-border); }

.tiles {
  margin-top: 28px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}

.y-tile { display: flex; flex-direction: column; }
.y-tile svg { color: var(--teal); }
.y-tile p { flex: 1; }

.y-tile .y-pill { margin-top: 12px; align-self: flex-start; }
.y-tile .y-pill + .y-pill { margin-top: 8px; }


.tip {
  margin-top: 32px;
  border-top: 1.5px solid var(--border-soft);
  padding-top: 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.mug { font-size: 20px; }
.pitch { min-width: 0; flex: 1; }
.pitch-title { font-weight: 800; font-size: 13.5px; }

.kofi {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 18px;
  border-radius: var(--r-pill);
  background: var(--teal);
  color: #fff;
  font-weight: 800;
  font-size: 13px;
  text-decoration: none;
}
.kofi:hover { background: var(--teal-dark); color: #fff; }

/* ---- first-visit walkthrough ---- */
.setup { margin-top: 20px; border-color: var(--teal-border); background: var(--teal-bg); }
.setup-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.setup-head > div:first-child { flex: 1; min-width: 220px; }
.setup-title { font-size: 17px; font-weight: 800; color: var(--teal-dark); }
.setup-meter {
  flex: none;
  width: 140px;
  height: 8px;
  border-radius: var(--r-pill);
  background: var(--teal-badge);
  overflow: hidden;
}
.setup-meter span { display: block; height: 100%; width: var(--pct, 0%); background: var(--teal); border-radius: inherit; transition: width 0.25s; }
.setup-steps { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 10px; }
.setup-step {
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  border: 1.5px solid var(--teal-border);
  border-radius: var(--r-sm);
  background: var(--bg-card);
}
.setup-step.done { opacity: 0.62; }
.setup-num {
  flex: none;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--teal-badge);
  color: var(--teal-dark);
  font-size: 12.5px;
  font-weight: 800;
}
.setup-step.done .setup-num { background: var(--ok-bg); color: var(--ok); }
.setup-body { flex: 1; min-width: 0; }
.setup-step-title { font-weight: 800; font-size: 14px; }
.setup-step.done .setup-step-title { text-decoration: line-through; }
.setup-body p { margin: 3px 0 0; }
.setup-ways { margin: 8px 0 0; padding-left: 18px; display: grid; gap: 5px; font-size: 12.5px; color: var(--fg-muted); }
.setup-ways a { color: var(--teal-dark); }
.setup-cta { margin-top: 10px; display: inline-flex; }
.setup-foot { margin-top: 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

@media (max-width: 860px) {
  .page { padding: 32px 24px; }
  .tiles { grid-template-columns: 1fr; }
}
@media (max-width: 759px) {
  .page { padding: 20px 16px 32px; max-width: none; width: 100%; }
  h1 { font-size: 26px; }
  .lede { font-size: 14.5px; }
  .tiles { margin-top: 20px; gap: 12px; }
  .setup-head > div:first-child { min-width: 0; flex-basis: 100%; }
  .setup-meter { width: 100%; }
  .setup-step { padding: 12px; }
  .setup-cta { display: flex; width: 100%; justify-content: center; }
  .setup-foot > * { flex: 1 1 100%; }
  .tip { flex-direction: column; align-items: stretch; text-align: center; }
  .mug { display: none; }
  .kofi { justify-content: center; min-height: 44px; }
}
</style>
