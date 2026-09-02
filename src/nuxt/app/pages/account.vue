<script setup lang="ts">
useHead({ title: 'Account' })
import { CURRENCIES } from '#shared/types/currency'
import { PALETTES, DEFAULT_PALETTE } from '#shared/types/palette'

const { user, loaded, refresh, logout } = useAuth()

const pat = ref('')
const patBusy = ref(false)
const patMessage = ref('')

const uploadBusy = ref(false)
const uploadMessage = ref('')
const fileInput = ref<HTMLInputElement>()

// ---- Profile ---------------------------------------------------------------
const firstName = ref('')
const lastName = ref('')
const currency = ref('USD')
const profileBusy = ref(false)
const profileSaved = ref(false)
const profileError = ref('')

const avatarBusy = ref(false)
const avatarError = ref('')
const avatarFile = ref<HTMLInputElement>()
const { avatarUrl, initials, hasCustom: hasCustomAvatar, source: avatarSource } = useAvatar()

// ---- Colour palette ----------------------------------------------------------
const { palette, save: savePalette } = usePalette()
const paletteBusy = ref(false)
const paletteError = ref('')
const paletteSavedAs = ref('')

async function choosePalette (id: string) {
  if (paletteBusy.value) return
  paletteBusy.value = true
  paletteError.value = ''
  try {
    await savePalette(id)
    paletteSavedAs.value = id
    setTimeout(() => { if (paletteSavedAs.value === id) paletteSavedAs.value = '' }, 2000)
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    paletteError.value = err.data?.statusMessage ?? 'Could not save that palette — it applies for now anyway.'
  } finally {
    paletteBusy.value = false
  }
}

const MAX_AVATAR_BYTES = 1024 * 1024

function syncFromUser () {
  firstName.value = user.value?.firstName ?? ''
  lastName.value = user.value?.lastName ?? ''
  currency.value = user.value?.currency ?? 'USD'
}

const route = useRoute()
const router = useRouter()

onMounted(async () => {
  await refresh()
  // Signed-out visitors never reach this page — auth.global.ts redirects them.
  if (!user.value) return
  syncFromUser()
  await Promise.all([loadLastSynced(), loadSources()])
  // Back from YNAB's authorize screen (see server/api/ynab/oauth/callback).
  const outcome = route.query.ynab
  if (typeof outcome === 'string') {
    if (outcome === 'connected') {
      patMessage.value = 'Connected to YNAB — now pick which plans to import.'
      await openPicker()
    } else if (outcome === 'denied') {
      patMessage.value = 'No problem — nothing was connected.'
    } else if (outcome === 'expired') {
      patMessage.value = 'That sign-in took too long or lost its session — try again.'
    } else {
      patMessage.value = 'YNAB did not finish the sign-in — try again in a moment.'
    }
    router.replace({ query: {}, hash: '#ynab-token' })
  }
})

// ---- Delete account -------------------------------------------------------
const deleteOpen = ref(false)
const deleteConfirm = ref('')
const deleteBusy = ref(false)
const deleteError = ref('')
const canDelete = computed(() => !deleteBusy.value && deleteConfirm.value.trim().toLowerCase() === (user.value?.email ?? '').toLowerCase())

async function deleteAccount () {
  if (!canDelete.value) return
  deleteBusy.value = true
  deleteError.value = ''
  try {
    await $fetch('/api/account', { method: 'DELETE', body: { confirm: deleteConfirm.value } })
    user.value = null
    await navigateTo('/login')
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    deleteError.value = err.data?.statusMessage ?? 'Could not delete the account — try again.'
    deleteBusy.value = false
  }
}

async function saveProfile () {
  if (profileBusy.value) return
  profileBusy.value = true
  profileError.value = ''
  try {
    await $fetch('/api/account/profile', {
      method: 'PATCH',
      body: { firstName: firstName.value, lastName: lastName.value, currency: currency.value }
    })
    await refresh()
    syncFromUser()
    profileSaved.value = true
    setTimeout(() => { profileSaved.value = false }, 2400)
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    profileError.value = err.data?.statusMessage ?? 'Could not save your profile.'
  } finally {
    profileBusy.value = false
  }
}

function pickAvatar () {
  avatarError.value = ''
  avatarFile.value?.click()
}

async function onAvatarPicked () {
  const file = avatarFile.value?.files?.[0]
  if (!file || avatarBusy.value) return

  // Check the cap before spending an upload round trip on it.
  if (file.size > MAX_AVATAR_BYTES) {
    avatarError.value = `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is 1MB.`
    if (avatarFile.value) avatarFile.value.value = ''
    return
  }

  avatarBusy.value = true
  avatarError.value = ''
  try {
    const body = new FormData()
    body.append('file', file)
    await $fetch('/api/account/avatar', { method: 'POST', body })
    await refresh()
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    avatarError.value = err.data?.statusMessage ?? 'Could not upload that image.'
  } finally {
    if (avatarFile.value) avatarFile.value.value = ''
    avatarBusy.value = false
  }
}

async function resetAvatar () {
  if (avatarBusy.value) return
  avatarBusy.value = true
  avatarError.value = ''
  try {
    await $fetch('/api/account/avatar', { method: 'DELETE' })
    await refresh()
  } finally {
    avatarBusy.value = false
  }
}

// ---- Re-sync from YNAB -----------------------------------------------------
type ResyncResult = {
  ok: boolean, mocked?: boolean, budgets: number,
  plans_synced: number, created: number, updated: number, first_pull: boolean
}

const resyncBusy = ref(false)
const resyncMessage = ref('')
const lastSynced = ref<string | null>(null)

// Mirrors the server's per-owner window so the button explains the wait
// instead of round-tripping into a 429.
const RESYNC_COOLDOWN_SECONDS = 120
const cooldown = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | undefined

function startCooldown (seconds: number) {
  cooldown.value = seconds
  clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0) clearInterval(cooldownTimer)
  }, 1000)
}

onUnmounted(() => clearInterval(cooldownTimer))

const resyncStatus = computed(() => {
  const wait = cooldown.value > 0 ? ` · next sync in ${cooldown.value}s` : ''
  if (resyncMessage.value) return resyncMessage.value + wait
  const base = lastSynced.value ? `Last debt sync ${timeAgo(lastSynced.value)}` : 'Debts not synced yet'
  return base + wait
})

async function loadLastSynced () {
  try {
    const data = await $fetch<{ lastSynced: string | null }>('/api/debt')
    lastSynced.value = data.lastSynced
  } catch { /* the status line just stays on its default */ }
}

async function resyncNow () {
  if (resyncBusy.value) return
  resyncBusy.value = true
  resyncMessage.value = ''
  try {
    const result = await $fetch<ResyncResult>('/api/ynab/resync', { method: 'POST' })
    if (result.mocked) {
      resyncMessage.value = `Sample data mode — ${result.budgets} mock budgets, nothing to pull`
    } else {
      const debts = result.created + result.updated
      resyncMessage.value = `Synced just now — ${result.budgets} live budget${result.budgets === 1 ? '' : 's'}, `
        + `${debts} debt account${debts === 1 ? '' : 's'} ${result.first_pull ? 'pulled in' : 'refreshed'}`
    }
    startCooldown(RESYNC_COOLDOWN_SECONDS)
    await loadLastSynced()
  } catch (cause: unknown) {
    const err = cause as { data?: { statusCode?: number, statusMessage?: string } }
    resyncMessage.value = err.data?.statusMessage ?? 'Could not reach YNAB — try again.'
    // A 429 means something else synced recently — honor the server's clock.
    const wait = /again in (\d+)s/.exec(err.data?.statusMessage ?? '')
    if (err.data?.statusCode === 429 && wait) startCooldown(Number(wait[1]))
  } finally {
    resyncBusy.value = false
  }
}

// ---- Budget sources ---------------------------------------------------------
type SourceRow = {
  id: string, name: string, kind: 'synced' | 'imported' | 'manual',
  currency: string, monthCount: number, lastSyncedAt: string | null, debtCount: number
}
type AvailablePlan = { id: string, name: string, currency: string, synced: boolean }

const sources = ref<SourceRow[]>([])
const confirmingId = ref<string | null>(null)
const sourceBusy = ref(false)
const sourceMessage = ref('')

const picker = ref<{ open: boolean, loading: boolean, plans: AvailablePlan[], chosen: string[], busy: boolean, error: string }>(
  { open: false, loading: false, plans: [], chosen: [], busy: false, error: '' }
)

const newBudget = ref({ open: false, name: '', currency: 'USD', busy: false, error: '' })

async function loadSources () {
  try {
    const data = await $fetch<{ sources: SourceRow[] }>('/api/sources')
    sources.value = data.sources
  } catch { /* the card shows its empty state */ }
}

// After a PAT lands (or on demand): list the budgets it can see and ask which
// ones to import — local-first, so "import" means snapshot into Plannrr's DB.
async function openPicker () {
  picker.value = { open: true, loading: true, plans: [], chosen: [], busy: false, error: '' }
  try {
    const data = await $fetch<{ plans: AvailablePlan[] }>('/api/ynab/available')
    picker.value.plans = data.plans
    picker.value.chosen = data.plans.filter(p => !p.synced).map(p => p.id)
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    picker.value.error = err.data?.statusMessage ?? 'Could not reach YNAB — try again.'
  } finally {
    picker.value.loading = false
  }
}

function togglePickerPlan (id: string) {
  const chosen = picker.value.chosen
  picker.value.chosen = chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id]
}

async function importChosen () {
  if (!picker.value.chosen.length || picker.value.busy) return
  picker.value.busy = true
  picker.value.error = ''
  try {
    const res = await $fetch<{ created: number, updated: number }>('/api/sources/ynab', {
      method: 'POST',
      body: { planIds: picker.value.chosen }
    })
    picker.value.open = false
    const n = res.created + res.updated
    sourceMessage.value = `Imported ${n} plan${n === 1 ? '' : 's'} from YNAB — pages now read your local copy.`
    startCooldown(RESYNC_COOLDOWN_SECONDS)
    await Promise.all([loadSources(), loadLastSynced()])
  } catch (cause: unknown) {
    const err = cause as { data?: { statusCode?: number, statusMessage?: string } }
    picker.value.error = err.data?.statusMessage ?? 'Import failed — try again.'
    const wait = /again in (\d+)s/.exec(err.data?.statusMessage ?? '')
    if (err.data?.statusCode === 429 && wait) startCooldown(Number(wait[1]))
  } finally {
    picker.value.busy = false
  }
}

async function createManualBudget () {
  const name = newBudget.value.name.trim()
  if (!name || newBudget.value.busy) return
  newBudget.value.busy = true
  newBudget.value.error = ''
  try {
    await $fetch('/api/sources/manual', { method: 'POST', body: { name, currency: newBudget.value.currency } })
    newBudget.value = { open: false, name: '', currency: 'USD', busy: false, error: '' }
    await loadSources()
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    newBudget.value.error = err.data?.statusMessage ?? 'Could not create the plan.'
    newBudget.value.busy = false
  }
}

async function deleteSource (row: SourceRow) {
  if (sourceBusy.value) return
  sourceBusy.value = true
  try {
    const res = await $fetch<{ debtsDeleted: number }>(`/api/sources/${row.id}`, { method: 'DELETE' })
    confirmingId.value = null
    sourceMessage.value = res.debtsDeleted
      ? `Removed “${row.name}” and ${res.debtsDeleted} debt account${res.debtsDeleted === 1 ? '' : 's'} from it.`
      : `Removed “${row.name}”.`
    await loadSources()
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    sourceMessage.value = err.data?.statusMessage ?? 'Could not remove that plan.'
  } finally {
    sourceBusy.value = false
  }
}

const KIND_LABEL: Record<string, string> = { synced: 'synced', imported: 'import', manual: 'manual' }

// ---- YNAB token + imports --------------------------------------------------
async function savePat () {
  if (!pat.value.trim() || patBusy.value) return
  patBusy.value = true
  patMessage.value = ''
  try {
    await $fetch('/api/account/pat', { method: 'POST', body: { pat: pat.value } })
    pat.value = ''
    patMessage.value = 'Token saved — now pick which plans to import.'
    await refresh()
    await openPicker()
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    patMessage.value = err.data?.statusMessage ?? 'Could not save the token.'
  } finally {
    patBusy.value = false
  }
}

async function removePat () {
  patBusy.value = true
  patMessage.value = ''
  try {
    await $fetch('/api/account/pat', { method: 'DELETE' })
    patMessage.value = 'Disconnected from YNAB. Your imported plans stay until you remove them.'
    await refresh()
  } finally {
    patBusy.value = false
  }
}

async function uploadZip () {
  const file = fileInput.value?.files?.[0]
  if (!file || uploadBusy.value) return
  uploadBusy.value = true
  uploadMessage.value = ''
  try {
    const body = new FormData()
    body.append('file', file)
    const result = await $fetch<{ name: string, months: number, categories: number }>('/api/imports', {
      method: 'POST',
      body
    })
    uploadMessage.value = `Imported “${result.name}” — ${result.months} months, ${result.categories} categories.`
    if (fileInput.value) fileInput.value.value = ''
    await loadSources()
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    uploadMessage.value = err.data?.statusMessage ?? 'Could not import that file.'
  } finally {
    uploadBusy.value = false
  }
}

async function signOut () {
  await logout()
  await navigateTo('/')
}
</script>

<template>
  <main class="page">
    <header class="top">
      <h1>Account</h1>
      <span v-if="user" class="who">{{ user.email }}</span>
      <button v-if="user" class="y-btn-secondary out" @click="signOut">Sign out</button>
    </header>

    <p v-if="!loaded" class="y-body loading">Loading…</p>

    <template v-else-if="user">
      <section id="profile" class="y-card">
        <div class="y-card-title">Profile</div>
        <div class="profile-body">
          <div class="avatar-col">
            <img v-if="avatarUrl" :src="avatarUrl" alt="Profile picture" width="84" height="84" class="avatar">
            <span v-else class="avatar initials">{{ initials }}</span>
            <span class="src" :class="{ custom: hasCustomAvatar }">{{ avatarSource }}</span>
          </div>

          <div class="profile-fields">
            <p class="hint">
              Pulled automatically from <b>Gravatar</b> for {{ user.email }}. Upload your own
              to override it — or change it for every app at
              <a href="https://gravatar.com" target="_blank" rel="noopener">gravatar.com</a>.
            </p>

            <div class="grid">
              <label class="y-field">First name
                <input v-model="firstName" type="text" autocomplete="given-name" maxlength="60">
              </label>
              <label class="y-field">Last name
                <input v-model="lastName" type="text" autocomplete="family-name" maxlength="60">
              </label>
              <label class="y-field">Email
                <input
                  type="email"
                  :value="user.email"
                  disabled
                  title="Sign-in email — change it by signing in with a new address"
                >
              </label>
              <label class="y-field">Currency
                <select v-model="currency">
                  <option v-for="c in CURRENCIES" :key="c.code" :value="c.code">{{ c.label }}</option>
                </select>
              </label>
            </div>
            <p class="y-tiny fine">
              Synced YNAB plans use the currency YNAB reports for that plan. This setting
              covers hand-tracked debts and no-YNAB mode.
            </p>

            <div class="actions">
              <input
                ref="avatarFile"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                class="hidden-file"
                aria-label="Profile picture"
                @change="onAvatarPicked"
              >
              <button class="y-btn-dashed" :disabled="avatarBusy" @click="pickAvatar">
                {{ avatarBusy ? 'Uploading…' : hasCustomAvatar ? 'Replace photo…' : 'Upload a photo…' }}
              </button>
              <button v-if="hasCustomAvatar" class="y-btn-link" :disabled="avatarBusy" @click="resetAvatar">
                Use Gravatar again
              </button>
              <button class="y-btn save" :disabled="profileBusy" @click="saveProfile">
                {{ profileSaved ? 'Saved ✓' : profileBusy ? 'Saving…' : 'Save profile' }}
              </button>
            </div>
            <p class="y-tiny fine">PNG, JPEG, WebP, or GIF — up to 1MB.</p>
            <p v-if="avatarError" class="y-error msg">{{ avatarError }}</p>
            <p v-if="profileError" class="y-error msg">{{ profileError }}</p>
          </div>
        </div>
      </section>

      <section id="palette" class="y-card">
        <div class="head-row">
          <div class="y-card-title">Colour palette</div>
          <span v-if="paletteSavedAs" class="y-badge">Saved ✓</span>
        </div>
        <p class="y-body">
          The whole app re-tints — sidebar, buttons, links, badges. Pick the one that feels like yours.
        </p>
        <div class="palettes" role="radiogroup" aria-label="Colour palette">
          <button
            v-for="p in PALETTES"
            :key="p.id"
            type="button"
            class="swatch"
            :class="{ on: palette === p.id }"
            role="radio"
            :aria-checked="palette === p.id"
            :disabled="paletteBusy"
            @click="choosePalette(p.id)"
          >
            <span class="swatch-art" :style="{ background: p.ground }">
              <span class="swatch-bar" :style="{ background: p.sidebar }" />
              <span class="swatch-dot" :style="{ background: p.accent }" />
              <span class="swatch-line" :style="{ background: p.accent }" />
            </span>
            <span class="swatch-name">{{ p.name }}<template v-if="p.id === DEFAULT_PALETTE"> · default</template></span>
          </button>
        </div>
        <p v-if="paletteError" class="y-error msg">{{ paletteError }}</p>
      </section>

      <section id="ynab-token" class="y-card">
        <div class="head-row">
          <div class="y-card-title">Connect YNAB</div>
          <span v-if="user.hasPat" class="y-badge">{{ user.ynabAuth === 'oauth' ? 'Connected · Sign in with YNAB' : 'Connected · token' }}</span>
        </div>
        <template v-if="user.ynabOauthAvailable">
          <p class="y-body">
            Pulls your plans live from YNAB. You'll approve Plannrr on YNAB's own page — no
            token to copy, and you can revoke it there any time. Access is only ever used
            server-side and never shown to anyone.
          </p>
          <div class="row">
            <a class="y-btn oauth-btn" href="/api/ynab/oauth/start">{{ user.ynabAuth === 'oauth' ? 'Reconnect with YNAB' : 'Sign in with YNAB' }}</a>
            <button v-if="user.hasPat" class="y-btn-secondary" type="button" :disabled="patBusy" @click="removePat">Disconnect</button>
          </div>
        </template>
        <template v-else>
          <p class="y-body">
            Pulls your plans live from YNAB. Create a personal access token under
            <a href="https://app.ynab.com/settings/developer" target="_blank" rel="noopener">YNAB → Account Settings → Developer</a>.
            It's stored encrypted and only ever used server-side.
          </p>
          <form class="row" @submit.prevent="savePat">
            <input
              v-model="pat"
              class="y-input grow"
              type="password"
              :placeholder="user.hasPat ? 'Replace saved token…' : 'Paste your token…'"
              aria-label="YNAB personal access token"
              autocomplete="off"
            >
            <button class="y-btn" type="submit" :disabled="patBusy || !pat.trim()">Save</button>
            <button v-if="user.hasPat" class="y-btn-secondary" type="button" :disabled="patBusy" @click="removePat">Remove</button>
          </form>
        </template>
        <p v-if="patMessage" class="y-tiny note">{{ patMessage }}</p>
        <div v-if="picker.open" class="picker">
          <div class="picker-head">Which plans should Plannrr import?</div>
          <p class="y-tiny picker-sub">
            Your copy lives in Plannrr — pages read it directly, and YNAB is only
            contacted again when you re-sync.
          </p>
          <p v-if="picker.loading" class="y-tiny">Asking YNAB for your plan list…</p>
          <template v-else>
            <label v-for="plan in picker.plans" :key="plan.id" class="picker-row">
              <input
                type="checkbox"
                :checked="picker.chosen.includes(plan.id)"
                @change="togglePickerPlan(plan.id)"
              >
              <span class="picker-name">{{ plan.name }}</span>
              <span v-if="plan.synced" class="y-pill y-pill-neutral picker-tag">already imported</span>
              <span class="y-tiny picker-cur">{{ plan.currency }}</span>
            </label>
            <div class="row picker-actions">
              <button class="y-btn" :disabled="picker.busy || !picker.chosen.length" @click="importChosen">
                {{ picker.busy ? 'Importing…' : `Import ${picker.chosen.length} plan${picker.chosen.length === 1 ? '' : 's'}` }}
              </button>
              <button class="y-btn-link" :disabled="picker.busy" @click="picker.open = false">Not now</button>
            </div>
          </template>
          <p v-if="picker.error" class="y-error msg">{{ picker.error }}</p>
        </div>
        <div v-if="user.hasPat" class="row resync">
          <button class="y-btn-outline" :disabled="resyncBusy || cooldown > 0" @click="resyncNow">
            {{ resyncBusy ? 'Syncing…' : '⟳ Re-sync from YNAB' }}
          </button>
          <button class="y-btn-secondary" :disabled="picker.busy" @click="openPicker">Choose plans…</button>
          <span class="y-tiny" role="status">{{ resyncStatus }}</span>
        </div>
        <p class="y-tiny note">
          Plannrr pulls from YNAB on sync; the only writes back are the ones you review and confirm in Tinkrr.
        </p>
      </section>

      <section id="sources" class="y-card">
        <div class="head-row">
          <div class="y-card-title">Plan sources</div>
          <button class="y-btn-dashed new-budget" @click="newBudget.open = !newBudget.open">+ New plan</button>
        </div>
        <p class="y-body">
          Everything Plannrr reads lives here — plans synced from YNAB, imported
          from an export zip, or built by hand. No YNAB required.
        </p>

        <div v-if="newBudget.open" class="row manual-form">
          <input
            v-model="newBudget.name"
            class="y-input grow"
            type="text"
            maxlength="80"
            placeholder="Plan name (🌱 Fresh Start)"
            aria-label="New plan name"
            @keyup.enter="createManualBudget"
          >
          <select v-model="newBudget.currency" class="y-input cur-select" aria-label="Currency">
            <option v-for="c in CURRENCIES" :key="c.code" :value="c.code">{{ c.label }}</option>
          </select>
          <button class="y-btn" :disabled="newBudget.busy || !newBudget.name.trim()" @click="createManualBudget">
            {{ newBudget.busy ? 'Creating…' : 'Create' }}
          </button>
        </div>
        <p v-if="newBudget.error" class="y-error msg">{{ newBudget.error }}</p>

        <div v-if="sources.length" class="source-list">
          <div v-for="row in sources" :key="row.id" class="source-row">
            <span class="y-pill kind" :class="`kind-${row.kind}`">{{ KIND_LABEL[row.kind] }}</span>
            <span class="source-name">{{ row.name }}</span>
            <span class="y-small source-meta">
              {{ row.monthCount }} month{{ row.monthCount === 1 ? '' : 's' }}
              <template v-if="row.lastSyncedAt"> · synced {{ timeAgo(row.lastSyncedAt) }}</template>
              <template v-if="row.debtCount"> · {{ row.debtCount }} debt{{ row.debtCount === 1 ? '' : 's' }}</template>
            </span>
            <template v-if="confirmingId === row.id">
              <span class="y-tiny confirm-note">
                Removes this plan from Plannrr{{ row.debtCount ? ` and its ${row.debtCount} synced debt${row.debtCount === 1 ? '' : 's'}` : '' }} — nothing changes in YNAB. Sure?
              </span>
              <button class="y-btn-danger" :disabled="sourceBusy" @click="deleteSource(row)">
                {{ sourceBusy ? 'Removing…' : 'Yes, remove' }}
              </button>
              <button class="y-btn-link" :disabled="sourceBusy" @click="confirmingId = null">Cancel</button>
            </template>
            <button v-else class="y-btn-danger" title="Remove from Plannrr — YNAB is untouched" @click="confirmingId = row.id">Remove</button>
          </div>
        </div>
        <p v-else class="y-body empty-sources">
          No plan sources yet — import from YNAB above, upload an export zip
          below, or create a plan by hand.
        </p>
        <p v-if="sourceMessage" class="y-tiny note" role="status">{{ sourceMessage }}</p>

        <div class="zip-block">
          <div class="zip-title">Import a YNAB export zip</div>
          <p class="y-body">
            No token needed: in YNAB, choose <i>Export Plan Data</i> and upload the zip here.
            Exports don't include goals, so each category's assigned amount becomes its
            monthly baseline in Tinkrr.
          </p>
          <form class="row" @submit.prevent="uploadZip">
            <input ref="fileInput" type="file" accept=".zip" aria-label="YNAB export zip" class="file">
            <button class="y-btn push" type="submit" :disabled="uploadBusy">
              {{ uploadBusy ? 'Importing…' : 'Import' }}
            </button>
          </form>
          <p v-if="uploadMessage" class="y-tiny note">{{ uploadMessage }}</p>
        </div>
      </section>

      <section id="delete" class="y-card danger-card">
        <div class="y-card-title">Delete my account</div>
        <p class="y-body">
          Removes everything Plannrr holds for you — imported plans, YNAB access, debts, drafts,
          story, feedback, and your picture — immediately and for good. Nothing changes in YNAB.
          See the <NuxtLink to="/privacy">privacy policy</NuxtLink> for what that covers.
        </p>
        <button v-if="!deleteOpen" class="y-btn-danger" @click="deleteOpen = true">Delete my account…</button>
        <template v-else>
          <label class="y-tiny" for="delete-confirm">Type <b>{{ user.email }}</b> to confirm</label>
          <div class="row">
            <input id="delete-confirm" v-model="deleteConfirm" class="y-input grow" type="email" autocomplete="off" :placeholder="user.email">
            <button class="y-btn-danger" :disabled="!canDelete" @click="deleteAccount">{{ deleteBusy ? 'Deleting…' : 'Delete everything' }}</button>
            <button class="y-btn-link" :disabled="deleteBusy" @click="deleteOpen = false; deleteConfirm = ''">Cancel</button>
          </div>
          <p v-if="deleteError" class="y-error msg">{{ deleteError }}</p>
        </template>
      </section>

      <NuxtLink to="/tinkrr" class="open">→ Open Tinkrr</NuxtLink>
    </template>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  min-width: 0;
  padding: 40px 56px 60px;
  max-width: 820px;
}

.top { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
h1 { font-size: 26px; }
.who { color: var(--fg-subtle); font-size: 13.5px; }
.out { margin-left: auto; }

.loading { margin-top: 24px; }

.y-card { margin-top: 18px; }
.y-card:first-of-type { margin-top: 24px; }

.profile-body { margin-top: 16px; display: flex; gap: 20px; align-items: flex-start; }

.avatar-col {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.avatar {
  width: 84px;
  height: 84px;
  border-radius: 50%;
  border: 2px solid var(--border);
  background: var(--teal);
  object-fit: cover;
}
.initials {
  display: grid;
  place-items: center;
  color: #fff;
  font-weight: 800;
  font-size: 26px;
}

.src {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  border-radius: var(--r-pill);
  padding: 2px 9px;
  background: var(--teal-badge);
  color: var(--teal-dark);
}
.src.custom { background: var(--neutral-bg); color: var(--fg-muted); }

.profile-fields { flex: 1; min-width: 0; }

/* 12.5px / fg-subtle — matches the design's helper copy exactly. */
.hint { margin: 0; font-size: 12.5px; color: var(--fg-subtle); line-height: 1.5; }

.grid {
  margin-top: 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.fine { margin: 8px 0 0; }

.actions {
  margin-top: 14px;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.save { margin-left: auto; padding: 9px 20px; }
.hidden-file { display: none; }

.msg { margin: 8px 0 0; font-size: 12.5px; }

.head-row { display: flex; align-items: center; gap: 10px; }

.y-body { margin: 8px 0 0; }

.row {
  margin-top: 14px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.grow { flex: 1; min-width: 12rem; }
.push { margin-left: auto; }
.file { font-size: 13px; color: var(--fg-muted); }

.resync { margin-top: 12px; }
.resync button { cursor: pointer; }
.resync button:disabled { cursor: wait; }

.note { margin: 12px 0 0; }


.open { display: inline-block; margin-top: 20px; font-weight: 800; font-size: 14px; }

/* ---- budget picker (post-PAT) ---- */
.picker {
  margin-top: 14px;
  border: 1.5px solid var(--teal-border);
  background: var(--teal-bg);
  border-radius: 12px;
  padding: 14px 16px;
}
.picker-head { font-weight: 800; font-size: 14px; }
.picker-sub { margin: 4px 0 10px; }
.picker-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 8px;
  border-radius: var(--r-xs);
  cursor: pointer;
}
.picker-row:hover { background: rgba(255, 255, 255, 0.6); }
.picker-row input { width: 15px; height: 15px; accent-color: var(--teal); }
.picker-name { font-size: 13.5px; font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker-tag { font-size: 10.5px; padding: 2px 8px; }
.picker-cur { margin-left: auto; }
.picker-actions { margin-top: 10px; }

/* ---- budget sources ---- */
.new-budget { margin-left: auto; padding: 7px 14px; font-size: 12.5px; }
.manual-form { margin-top: 12px; }
.cur-select { flex: none; width: auto; }

.source-list { margin-top: 14px; border-top: 1.5px solid var(--border-soft); }
.source-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-hair);
  flex-wrap: wrap;
}
.kind { font-size: 10.5px; letter-spacing: 0.4px; text-transform: uppercase; padding: 2px 9px; flex: none; }
.kind-synced { background: var(--teal-badge); color: var(--teal-dark); }
.kind-imported { background: var(--neutral-bg); color: var(--fg-muted); }
.kind-manual { background: var(--warn-bg); color: var(--warn); }
.source-name { font-weight: 700; font-size: 13.5px; }
.source-meta { margin-right: auto; }
.confirm-note { color: var(--danger); font-weight: 700; }
.empty-sources { margin-top: 12px; }

.zip-block { margin-top: 18px; border-top: 1.5px solid var(--border-soft); padding-top: 14px; }
.zip-title { font-weight: 800; font-size: 13.5px; }

/* ---- palette swatches ---- */
.palettes {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
}
.swatch {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 7px;
  padding: 6px;
  border: 1.5px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-card);
  cursor: pointer;
  font: inherit;
  color: var(--fg-muted);
  transition: border-color 0.12s, box-shadow 0.12s;
}
.swatch:hover:not(:disabled) { border-color: var(--border-strong); }
.swatch.on { border-color: var(--teal); box-shadow: 0 0 0 2px var(--teal-badge); color: var(--teal-dark); }
.swatch:disabled { cursor: default; }
.swatch-art {
  position: relative;
  height: 54px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border-soft);
  overflow: hidden;
  display: block;
}
.swatch-bar { position: absolute; inset: 0 auto 0 0; width: 30%; }
.swatch-dot { position: absolute; top: 12px; left: 42%; width: 14px; height: 14px; border-radius: 50%; }
.swatch-line { position: absolute; left: 42%; right: 12%; top: 34px; height: 6px; border-radius: 3px; opacity: 0.45; }
.swatch-name { font-size: 12px; font-weight: 800; text-align: center; }

@media (max-width: 860px) {
  .page { padding: 32px 24px 48px; }
  .profile-body { flex-direction: column; }
  .grid { grid-template-columns: 1fr; }
}
.oauth-btn { text-decoration: none; display: inline-flex; align-items: center; }
.danger-card { border-color: var(--danger-bg); }
</style>
