<script setup lang="ts">
const { user, loaded, refresh, logout } = useAuth()

type ImportRow = { id: string, name: string, months: number, created_at: string }
const imports = ref<ImportRow[]>([])

const pat = ref('')
const patBusy = ref(false)
const patMessage = ref('')

const uploadBusy = ref(false)
const uploadMessage = ref('')
const fileInput = ref<HTMLInputElement>()

onMounted(async () => {
  await refresh()
  if (!user.value) {
    await navigateTo('/login')
    return
  }
  await loadImports()
})

async function loadImports () {
  try {
    const data = await $fetch<{ imports: ImportRow[] }>('/api/imports')
    imports.value = data.imports
  } catch { /* session expired — the next action will surface it */ }
}

async function savePat () {
  if (!pat.value.trim() || patBusy.value) return
  patBusy.value = true
  patMessage.value = ''
  try {
    await $fetch('/api/account/pat', { method: 'POST', body: { pat: pat.value } })
    pat.value = ''
    patMessage.value = 'Token saved — your budgets will load on the sandbox.'
    await refresh()
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
    patMessage.value = 'Token removed.'
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
    await loadImports()
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    uploadMessage.value = err.data?.statusMessage ?? 'Could not import that file.'
  } finally {
    uploadBusy.value = false
  }
}

async function removeImport (id: string) {
  await $fetch(`/api/imports/${id}`, { method: 'DELETE' })
  await loadImports()
}

async function signOut () {
  await logout()
  await navigateTo('/')
}
</script>

<template>
  <main class="page">
    <header class="top">
      <h1><NuxtLink to="/">YNABRR</NuxtLink> <span class="crumb">/ Account</span></h1>
      <div v-if="user" class="who">
        <span>{{ user.email }}</span>
        <button class="ghost" @click="signOut">Sign out</button>
      </div>
    </header>

    <p v-if="!loaded">Loading…</p>

    <template v-else-if="user">
      <section class="card">
        <h2>YNAB access token</h2>
        <p>
          Pull your budgets live from YNAB. Create a personal access token under
          <a href="https://app.ynab.com/settings/developer" target="_blank" rel="noopener">YNAB → Account Settings → Developer</a>.
          It's stored encrypted and only ever used server-side.
        </p>
        <p v-if="user.hasPat" class="ok">✓ A token is saved on your account.</p>
        <form @submit.prevent="savePat">
          <input
            v-model="pat"
            type="password"
            :placeholder="user.hasPat ? 'Replace saved token…' : 'Paste your token…'"
            aria-label="YNAB personal access token"
            autocomplete="off"
          >
          <button class="primary" type="submit" :disabled="patBusy || !pat.trim()">Save</button>
          <button v-if="user.hasPat" class="ghost" type="button" :disabled="patBusy" @click="removePat">Remove</button>
        </form>
        <p v-if="patMessage" class="note">{{ patMessage }}</p>
      </section>

      <section class="card">
        <h2>Import a YNAB export</h2>
        <p>
          No token needed: in YNAB, choose <em>Export Plan Data</em> and upload the zip here.
          Exports don't include goals, so each category's assigned amount becomes its monthly
          baseline in the sandbox.
        </p>
        <form @submit.prevent="uploadZip">
          <input ref="fileInput" type="file" accept=".zip" aria-label="YNAB export zip">
          <button class="primary" type="submit" :disabled="uploadBusy">
            {{ uploadBusy ? 'Importing…' : 'Import' }}
          </button>
        </form>
        <p v-if="uploadMessage" class="note">{{ uploadMessage }}</p>

        <ul v-if="imports.length" class="imports">
          <li v-for="row in imports" :key="row.id">
            <span>{{ row.name }} · {{ row.months }} months</span>
            <button class="ghost" @click="removeImport(row.id)">Delete</button>
          </li>
        </ul>
      </section>

      <p><NuxtLink to="/sandbox">→ Open the sandbox</NuxtLink></p>
    </template>
  </main>
</template>

<style scoped>
.page {
  max-width: 36rem;
  margin: 0 auto;
  padding: 3rem 1.5rem;
  font-family: system-ui, sans-serif;
  line-height: 1.5;
}

.top {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: baseline;
  justify-content: space-between;
}

h1 { margin: 0; }
h1 a { color: inherit; text-decoration: none; }
.crumb { color: #999; font-weight: 400; }

.who {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  color: #555;
  font-size: 0.9rem;
}

.card {
  margin: 1.25rem 0;
  padding: 1.1rem 1.35rem;
  border: 1px solid #ddd;
  border-radius: 8px;
}

.card h2 { margin: 0 0 0.4rem; font-size: 1.05rem; }
.card p { margin: 0.35rem 0; color: #555; font-size: 0.925rem; }

form {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
  flex-wrap: wrap;
  align-items: center;
}

input[type='password'] {
  flex: 1;
  min-width: 12rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  font: inherit;
}

.primary {
  padding: 0.45rem 0.95rem;
  border: 1px solid #4a7dff;
  border-radius: 6px;
  background: #4a7dff;
  color: #fff;
  font: inherit;
  cursor: pointer;
}

.primary:disabled { opacity: 0.6; }

.ghost {
  padding: 0.45rem 0.95rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  font: inherit;
  cursor: pointer;
}

.ok { color: #1b7f3b; }
.note { color: #555; }

.imports {
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}

.imports li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.45rem 0;
  border-top: 1px solid #eee;
}
</style>
