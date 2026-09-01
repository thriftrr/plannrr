<script setup lang="ts">
useHead({ title: 'Remembrr' })
import type { StoryEvent, StoryKind } from '#shared/types/story'

// Remembrr — the debt story, told as editable "moment" cards on a timeline.
// State here is in DOLLARS; milliunits are converted at the API boundary.

type Card = StoryEvent

const events = ref<Card[]>([])
const loading = ref(true)
const editingId = ref<string | null>(null)
const hoverGap = ref<number | null>(null)
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const saveError = ref('')

const importOpen = ref(false)
const importText = ref('')
const replaceMode = ref(false)

let saveTimer: ReturnType<typeof setTimeout> | undefined

onMounted(async () => {
  try {
    const data = await $fetch<{ events: StoryEvent[] }>('/api/story')
    events.value = data.events.map(ev => ({ ...ev, amount: ev.amount / 1000 }))
  } catch { /* empty story — the empty state offers ways in */ }
  loading.value = false
})

onUnmounted(() => clearTimeout(saveTimer))

function scheduleSave () {
  saveState.value = 'saving'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 600)
}

async function saveNow () {
  try {
    await $fetch('/api/story', {
      method: 'PUT',
      body: { events: events.value.map(ev => ({ ...ev, amount: Math.round(ev.amount * 1000) })) }
    })
    saveState.value = 'saved'
    saveError.value = ''
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    saveState.value = 'error'
    saveError.value = err.data?.statusMessage ?? 'Could not save — changes are only in this tab.'
  }
}

const saveLabel = computed(() => {
  if (saveState.value === 'saving') return 'Saving…'
  if (saveState.value === 'saved') return 'Saved ✓'
  if (saveState.value === 'error') return saveError.value
  return ''
})

// ---- Money -----------------------------------------------------------------
const fmt = (v: number) => '$' + Math.round(Math.abs(v)).toLocaleString('en-US')

// ---- Timeline rows ---------------------------------------------------------
const rows = computed(() => {
  let running = 0
  return events.value.map((ev) => {
    running += ev.kind === 'opened' ? ev.amount : -ev.amount
    return { ev, running }
  })
})

// ---- View: sort + filters --------------------------------------------------
// Filters and sorts are a LENS on the story, never the story itself: running
// totals stay computed from canonical order, and inserting between cards only
// makes sense there — so the hover gaps appear in story order alone.
const kindFilter = ref<'all' | StoryKind>('all')
const searchText = ref('')
const sortMode = ref<'story' | 'latest' | 'amount'>('story')

const kindCounts = computed(() => {
  const counts = { opened: 0, closed: 0, note: 0 }
  for (const ev of events.value) counts[ev.kind]++
  return counts
})

const canonicalView = computed(() =>
  sortMode.value === 'story' && kindFilter.value === 'all' && !searchText.value.trim())

const viewRows = computed(() => {
  let list = rows.value
  if (kindFilter.value !== 'all') list = list.filter(r => r.ev.kind === kindFilter.value)
  const needle = searchText.value.trim().toLowerCase()
  if (needle) {
    list = list.filter(r =>
      `${r.ev.title} ${r.ev.note} ${r.ev.dateLabel}`.toLowerCase().includes(needle))
  }
  if (sortMode.value === 'latest') list = [...list].reverse()
  else if (sortMode.value === 'amount') list = [...list].sort((a, b) => Math.abs(b.ev.amount) - Math.abs(a.ev.amount))
  return list
})

const openDebtCount = computed(() => {
  const opened = events.value.filter(ev => ev.kind === 'opened').length
  const closed = events.value.filter(ev => ev.kind === 'closed').length
  return Math.max(opened - closed, 0)
})

const runningTotal = computed(() => rows.value.length ? rows.value[rows.value.length - 1]!.running : 0)

const todayLine = computed(() => {
  const debts = openDebtCount.value
  return `Running total ${fmt(runningTotal.value)} · ${debts} debt${debts === 1 ? '' : 's'} still open`
})

// ---- Mutations -------------------------------------------------------------
function insertAt (index: number) {
  const card: Card = { id: crypto.randomUUID(), dateLabel: defaultDateLabel(), kind: 'opened', title: '', amount: 0, note: '' }
  events.value.splice(index, 0, card)
  editingId.value = card.id
  hoverGap.value = null
  scheduleSave()
}

function defaultDateLabel () {
  return new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function removeCard (id: string) {
  events.value = events.value.filter(ev => ev.id !== id)
  editingId.value = null
  scheduleSave()
}

function onAmountChange (card: Card, raw: string) {
  const value = Number.parseFloat(raw.replace(/[$,]/g, ''))
  if (Number.isFinite(value)) {
    card.amount = Math.abs(value)
    scheduleSave()
  }
}

function blurOnEnter (event: KeyboardEvent) {
  if (event.key === 'Enter') (event.target as HTMLElement).blur()
}

// ---- Badges / colors -------------------------------------------------------
const KIND_META: Record<StoryKind, { badge: string, dot: string, badgeClass: string }> = {
  opened: { badge: 'took on', dot: 'var(--danger)', badgeClass: 'opened' },
  closed: { badge: 'paid off', dot: 'var(--ok-dot)', badgeClass: 'closed' },
  note: { badge: 'progress', dot: 'var(--border-strong)', badgeClass: 'note' }
}

// ---- Import / export -------------------------------------------------------
type ParsedImport = { cards: Card[] | null, error: string }

const parsedImport = computed<ParsedImport>(() => {
  const text = importText.value
  if (!text.trim()) return { cards: null, error: '' }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (cause) {
    return { cards: null, error: 'Not valid JSON — ' + (cause as Error).message }
  }
  if (!Array.isArray(data)) return { cards: null, error: 'Expected an array of cards at the top level.' }
  const cards: Card[] = []
  for (let i = 0; i < data.length; i++) {
    const c = data[i] as Record<string, unknown>
    if (!c || typeof c !== 'object') return { cards: null, error: `Card ${i + 1} isn't an object.` }
    if (!c.title && !c.date) return { cards: null, error: `Card ${i + 1} needs at least a title and date.` }
    const kind: StoryKind = ['opened', 'closed', 'note'].includes(c.kind as string) ? c.kind as StoryKind : 'opened'
    const amount = Math.abs(Number.parseFloat(String(c.amount))) || 0
    cards.push({
      id: crypto.randomUUID(),
      dateLabel: String(c.date ?? ''),
      kind,
      title: String(c.title ?? ''),
      amount,
      note: String(c.note ?? '')
    })
  }
  return { cards, error: '' }
})

const canImport = computed(() => Boolean(parsedImport.value.cards?.length))

const importStatus = computed(() => {
  const parsed = parsedImport.value
  if (parsed.error) return parsed.error
  if (parsed.cards?.length) return `${parsed.cards.length} card${parsed.cards.length === 1 ? '' : 's'} ready ✓`
  return 'Waiting for JSON…'
})

function pickImportFile () {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { importText.value = String(reader.result) }
    reader.readAsText(file)
  }
  input.click()
}

function doImport () {
  const cards = parsedImport.value.cards
  if (!cards?.length) return
  events.value = replaceMode.value ? cards : [...events.value, ...cards]
  importOpen.value = false
  importText.value = ''
  editingId.value = null
  scheduleSave()
}

function exportJson () {
  const out = events.value.map(({ dateLabel, kind, title, amount, note }) =>
    note ? { date: dateLabel, kind, title, amount, note } : { date: dateLabel, kind, title, amount })
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'remembrr-story.json'
  a.click()
  URL.revokeObjectURL(url)
}

// ---- Seed from debts -------------------------------------------------------
type DebtRow = {
  name: string, hidden: boolean, history: unknown[],
  startDate: string, endDate: string | null, updatedAt: string | null,
  startBalance: number, balance: number,
  userStartDate: string | null, userStartBalance: number | null, userName: string | null
}

const seeding = ref(false)
const seedError = ref('')

function monthLabel (iso: string | null): string {
  if (!iso) return defaultDateLabel()
  const d = new Date(iso.length === 7 ? iso + '-01' : iso)
  if (Number.isNaN(d.getTime())) return defaultDateLabel()
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

async function seedFromDebts () {
  if (seeding.value) return
  seeding.value = true
  seedError.value = ''
  try {
    const data = await $fetch<{ debts: DebtRow[] }>('/api/debt')
    const visible = data.debts.filter(d => !d.hidden && d.history.length > 0)
    if (!visible.length) {
      seedError.value = 'No synced debts found — sync on Debt Colectrr first, or start blank.'
      return
    }
    const moments: Array<Card & { sort: string }> = []
    for (const debt of visible) {
      const name = debt.userName ?? debt.name
      const openedIso = debt.userStartDate || debt.startDate || ''
      const original = Math.abs((debt.userStartBalance ?? debt.startBalance) / 1000)
      moments.push({
        id: crypto.randomUUID(),
        dateLabel: monthLabel(openedIso || null),
        kind: 'opened',
        title: name,
        amount: Math.round(original),
        note: '',
        sort: (openedIso || '0000') + ':a'
      })
      if (debt.balance >= 0) {
        const closedIso = debt.endDate || debt.updatedAt || ''
        moments.push({
          id: crypto.randomUUID(),
          dateLabel: monthLabel(closedIso || null),
          kind: 'closed',
          title: name,
          amount: Math.round(original),
          note: '',
          sort: (closedIso || '9999') + ':b'
        })
      }
    }
    moments.sort((a, b) => a.sort.localeCompare(b.sort))
    events.value = moments.map(({ sort: _sort, ...card }) => card)
    scheduleSave()
  } catch (cause: unknown) {
    const err = cause as { data?: { statusMessage?: string } }
    seedError.value = err.data?.statusMessage ?? 'Could not read your debts — try again.'
  } finally {
    seeding.value = false
  }
}

function startBlank () {
  insertAt(0)
}
</script>

<template>
  <main class="page">
    <div class="top">
      <h1>Remembrr</h1>
      <NuxtLink to="/debt-colectrr" class="backlink">← Back to Debt Colectrr</NuxtLink>
      <span class="save-note" :class="{ err: saveState === 'error' }">{{ saveLabel }}</span>
      <div class="top-actions">
        <button class="y-btn-outline" @click="importOpen = true">⇪ Import JSON</button>
        <button class="y-btn-secondary" @click="exportJson">⇓ Export JSON</button>
      </div>
    </div>

    <p class="lede">
      Every debt taken on and paid off, in order, with the running total after
      each event. It's your story — hover between cards to add a moment, click
      ✎ to edit any card, and leave yourself a note about what was really going on.
    </p>

    <p v-if="loading" class="y-body wait">Loading your story…</p>

    <!-- Empty story: three ways to begin. -->
    <section v-else-if="!events.length" class="y-card empty">
      <div class="y-card-title">Start your story</div>
      <p class="y-body">
        Seed the timeline from the debts Plannrr already knows about, begin with a
        blank card, or bring a story you exported before.
      </p>
      <div class="empty-actions">
        <button class="y-btn" :disabled="seeding" @click="seedFromDebts">
          {{ seeding ? 'Reading your debts…' : '✨ Start from your debts' }}
        </button>
        <button class="y-btn-secondary" @click="startBlank">Start blank</button>
        <button class="y-btn-outline" @click="importOpen = true">⇪ Import JSON</button>
      </div>
      <p v-if="seedError" class="y-error seed-err">{{ seedError }}</p>
    </section>

    <template v-else>
      <div class="view-controls">
        <div class="chips">
          <button class="chip" :class="{ on: kindFilter === 'all' }" @click="kindFilter = 'all'">All · {{ events.length }}</button>
          <button class="chip" :class="{ on: kindFilter === 'opened' }" @click="kindFilter = kindFilter === 'opened' ? 'all' : 'opened'">Took on · {{ kindCounts.opened }}</button>
          <button class="chip" :class="{ on: kindFilter === 'closed' }" @click="kindFilter = kindFilter === 'closed' ? 'all' : 'closed'">Paid off · {{ kindCounts.closed }}</button>
          <button class="chip" :class="{ on: kindFilter === 'note' }" @click="kindFilter = kindFilter === 'note' ? 'all' : 'note'">Progress · {{ kindCounts.note }}</button>
        </div>
        <input
          v-model="searchText"
          type="search"
          class="view-search"
          placeholder="Filter moments…"
          aria-label="Filter moments by title, note, or date"
          @keyup.escape="searchText = ''"
        >
        <select v-model="sortMode" class="view-sort" aria-label="Sort the story">
          <option value="story">Story order</option>
          <option value="latest">Latest first</option>
          <option value="amount">Biggest amount</option>
        </select>
      </div>
      <p v-if="!canonicalView" class="view-note">
        Filtered view — “owed after” keeps its story-order meaning; switch back to
        <button class="y-btn-link inline" @click="kindFilter = 'all'; searchText = ''; sortMode = 'story'">story order</button>
        to add moments between cards.
      </p>

      <div class="timeline">
        <div class="rail-line" />
        <div class="col">
          <template v-for="(row, i) in viewRows" :key="row.ev.id">
            <div
              v-if="canonicalView"
              class="gap"
              :class="{ active: hoverGap === i }"
              @mouseenter="hoverGap = i"
              @mouseleave="hoverGap = null"
            >
              <button v-if="hoverGap === i" class="insert" @click="insertAt(i)">+ Add a moment here</button>
            </div>
            <div class="entry">
              <div class="dot" :style="{ background: KIND_META[row.ev.kind].dot }" />
              <div class="card" :class="{ editing: editingId === row.ev.id }">
                <template v-if="editingId === row.ev.id">
                  <div class="edit-grid">
                    <label class="f">Date
                      <input v-model="row.ev.dateLabel" type="text" placeholder="Aug 2026" @input="scheduleSave" @keydown="blurOnEnter">
                    </label>
                    <label class="f">Event
                      <select v-model="row.ev.kind" @change="scheduleSave">
                        <option value="opened">took on</option>
                        <option value="closed">paid off</option>
                        <option value="note">progress</option>
                      </select>
                    </label>
                    <label class="f">Title
                      <input v-model="row.ev.title" type="text" placeholder="🚗 The Honda" @input="scheduleSave" @keydown="blurOnEnter">
                    </label>
                    <label class="f">Amount
                      <input
                        :value="row.ev.amount"
                        type="text"
                        inputmode="decimal"
                        @change="onAmountChange(row.ev, ($event.target as HTMLInputElement).value)"
                        @keydown="blurOnEnter"
                      >
                    </label>
                  </div>
                  <label class="f note-f">Note — what was going on?
                    <textarea
                      v-model="row.ev.note"
                      rows="2"
                      placeholder="e.g. moved for the new job, sold the condo to make it work…"
                      @input="scheduleSave"
                    />
                  </label>
                  <div class="edit-actions">
                    <button class="y-btn done" @click="editingId = null">Done</button>
                    <button class="y-btn-danger del" @click="removeCard(row.ev.id)">Delete card</button>
                  </div>
                </template>

                <template v-else>
                  <div class="line">
                    <span class="date">{{ row.ev.dateLabel }}</span>
                    <span class="badge" :class="KIND_META[row.ev.kind].badgeClass">{{ KIND_META[row.ev.kind].badge }}</span>
                    <span class="title">{{ row.ev.title || 'Untitled moment' }}</span>
                    <span class="amt" :class="row.ev.kind === 'opened' ? 'red' : 'green'">
                      {{ (row.ev.kind === 'opened' ? '+' : '−') + fmt(row.ev.amount) }}
                    </span>
                    <button class="pen" title="Edit this card" @click="editingId = row.ev.id">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                    </button>
                  </div>
                  <div v-if="row.ev.note" class="note">“{{ row.ev.note }}”</div>
                  <div class="running">owed after: <b>{{ fmt(row.running) }}</b></div>
                </template>
              </div>
            </div>
          </template>
          <p v-if="!viewRows.length" class="view-empty">No moments match — clear the filters above.</p>
          <div
            v-if="canonicalView"
            class="gap"
            :class="{ active: hoverGap === events.length }"
            @mouseenter="hoverGap = events.length"
            @mouseleave="hoverGap = null"
          >
            <button v-if="hoverGap === events.length" class="insert" @click="insertAt(events.length)">+ Add a moment here</button>
          </div>
        </div>
      </div>

      <div class="today">
        <span class="today-word">Today</span>
        <span class="today-line">{{ todayLine }}</span>
      </div>
    </template>

    <PageFooter />

    <!-- Import modal -->
    <div v-if="importOpen" class="overlay" @click="importOpen = false">
      <div class="modal" @click.stop>
        <div class="modal-head">
          <div class="modal-title">Import moments from JSON</div>
          <button class="x" @click="importOpen = false">✕</button>
        </div>
        <p class="modal-copy">
          Paste (or pick a file with) an <b>array of cards</b>. Each card needs
          <code>date</code>, <code>kind</code>, <code>title</code>, and
          <code>amount</code>; <code>note</code> is optional. <code>kind</code>
          is one of <b>opened</b> (took on), <b>closed</b> (paid off), or
          <b>note</b> (progress).
        </p>
        <pre class="example">[
  { "date": "Jun 2024", "kind": "opened",
    "title": "🚐 M&amp;T RV loan", "amount": 19591,
    "note": "The RV that started it all" },
  { "date": "Apr 2025", "kind": "closed",
    "title": "🚗 The Honda", "amount": 19000 }
]</pre>
        <textarea v-model="importText" rows="6" class="paste" placeholder="Paste your JSON here…" />
        <div class="import-row">
          <button class="y-btn-dashed" @click="pickImportFile">…or choose a .json file</button>
          <span class="status" :class="{ bad: parsedImport.error, good: canImport }">{{ importStatus }}</span>
        </div>
        <label class="replace">
          <input v-model="replaceMode" type="checkbox">
          Replace the whole story (unchecked = add to the end)
        </label>
        <div class="modal-actions">
          <button class="y-btn-secondary" @click="importOpen = false">Cancel</button>
          <button class="y-btn" :disabled="!canImport" @click="doImport">
            {{ canImport ? `Import ${parsedImport.cards!.length} card${parsedImport.cards!.length === 1 ? '' : 's'}` : 'Import' }}
          </button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.page {
  flex: 1;
  min-width: 0;
  padding: 26px 32px 60px;
  max-width: 760px;
}

.top { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
h1 { font-size: 26px; }
.backlink { font-weight: 800; font-size: 13.5px; }
.save-note { font-size: 12px; color: var(--fg-faint); }
.save-note.err { color: var(--danger); }
.top-actions { margin-left: auto; display: flex; gap: 8px; }

.lede { margin: 10px 0 0; color: var(--fg-muted); font-size: 14px; line-height: 1.55; max-width: 560px; }
.wait { margin-top: 24px; }

.empty { margin-top: 26px; }
.empty .y-body { margin: 8px 0 0; }
.empty-actions { margin-top: 14px; display: flex; gap: 10px; flex-wrap: wrap; }
.seed-err { margin: 10px 0 0; font-size: 13px; }

/* ---- timeline ---- */
.view-controls {
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  padding: 5px 12px;
  border-radius: var(--r-pill);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  border: 1.5px solid var(--border-input);
  background: var(--bg-card);
  color: var(--fg-muted);
}
.chip.on { border-color: var(--teal); background: var(--teal); color: #fff; }
.view-search {
  margin-left: auto;
  width: 170px;
  padding: 7px 11px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-sm);
  background: var(--bg-card);
  font-size: 13px;
}
.view-search:focus { border-color: var(--teal); outline: none; }
.view-sort {
  padding: 7px 9px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-sm);
  background: var(--bg-card);
  font-size: 12.5px;
  font-weight: 700;
  color: var(--fg-muted);
}
.view-note {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--fg-faint);
}
.view-note .inline { font-size: 12px; }
.view-empty { padding: 18px 0; font-size: 13px; color: var(--fg-faint); }

.timeline { margin-top: 26px; position: relative; padding-left: 26px; }
.rail-line {
  position: absolute;
  left: 7px;
  top: 6px;
  bottom: 6px;
  width: 2.5px;
  background: var(--border);
  border-radius: 2px;
}
.col { display: flex; flex-direction: column; }

.gap {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: height 0.15s;
  height: 14px;
}
.gap.active { height: 38px; }
.insert {
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1.5px dashed var(--teal);
  border-radius: var(--r-pill);
  background: var(--teal-bg);
  color: var(--teal-dark);
  font-weight: 800;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 14px;
}

.entry { position: relative; }
.dot {
  position: absolute;
  left: -26px;
  top: 16px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 3px solid var(--bg-app);
}
.card {
  background: var(--bg-card);
  border: 1.5px solid var(--border);
  border-radius: 12px;
  padding: 13px 16px;
}
.card.editing { border-color: var(--teal); }

.line { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; }
.date { font-size: 11.5px; font-weight: 800; color: var(--fg-faint); width: 70px; flex: none; }
.badge {
  flex: none;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  border-radius: var(--r-pill);
  padding: 2px 9px;
}
.badge.opened { background: var(--danger-bg); color: var(--danger); }
.badge.closed { background: var(--ok-bg); color: var(--ok); }
.badge.note { background: var(--neutral-bg); color: var(--fg-subtle); }
.title { font-weight: 800; font-size: 14.5px; }
.amt { margin-left: auto; font-weight: 800; font-size: 14.5px; white-space: nowrap; }
.amt.red { color: var(--danger); }
.amt.green { color: var(--ok); }
.pen {
  border: none;
  background: none;
  cursor: pointer;
  padding: 0;
  width: 18px;
  color: var(--border-input);
  display: grid;
  place-items: center;
  flex: none;
}
.pen:hover { color: var(--teal-dark); }
.pen svg { display: block; }

.note {
  margin-top: 2px;
  padding-left: 79px;
  font-size: 12.5px;
  color: var(--fg-muted);
  line-height: 1.5;
  font-style: italic;
}
.running {
  margin-top: 4px;
  padding-left: 79px;
  text-align: right;
  font-size: 12px;
  color: var(--fg-subtle);
  white-space: nowrap;
}
.running b { color: #4a463c; }

/* ---- edit mode ---- */
.edit-grid { display: grid; grid-template-columns: 110px 130px 1fr 110px; gap: 10px; }
.f {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--fg-subtle);
}
.f input, .f select, .f textarea {
  padding: 6px 9px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-xs);
  font-size: 13px;
  font-weight: 700;
  background: var(--bg-input);
  color: var(--fg);
  text-transform: none;
  letter-spacing: normal;
}
.f input:focus, .f select:focus, .f textarea:focus { border-color: var(--teal); outline: none; }
.note-f { margin-top: 10px; }
.note-f textarea { padding: 8px 10px; font-weight: 400; resize: vertical; line-height: 1.5; }
.edit-actions { margin-top: 10px; display: flex; gap: 10px; }
.done { padding: 7px 18px; font-size: 12.5px; }
.del { margin-left: auto; }

/* ---- today strip ---- */
.today {
  margin-top: 14px;
  margin-left: 26px;
  background: var(--teal-badge);
  border: 1.5px solid #a8dcd6;
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.today-word { font-weight: 800; font-size: 15px; color: var(--teal-dark); }
.today-line { font-size: 13.5px; color: #3c4a46; }

/* ---- import modal ---- */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(43, 42, 38, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.modal {
  width: 560px;
  max-width: 100%;
  max-height: 86vh;
  overflow: auto;
  background: var(--bg-card);
  border-radius: var(--r-panel);
  padding: 24px;
  box-shadow: 0 12px 40px rgba(43, 42, 38, 0.3);
}
.modal-head { display: flex; align-items: baseline; gap: 10px; }
.modal-title { font-weight: 800; font-size: 17px; }
.x { margin-left: auto; border: none; background: none; color: var(--fg-subtle); font-size: 16px; font-weight: 800; cursor: pointer; padding: 0; }
.modal-copy { margin: 8px 0 0; font-size: 13px; color: var(--fg-muted); line-height: 1.55; }
.modal-copy code { background: var(--bg-app); padding: 1px 5px; border-radius: 4px; }
.example {
  margin: 12px 0 0;
  background: var(--fg);
  color: var(--nav-fg);
  border-radius: 10px;
  padding: 14px 16px;
  font-size: 12px;
  line-height: 1.6;
  overflow: auto;
}
.paste {
  margin-top: 12px;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-field);
  font-size: 12.5px;
  font-family: ui-monospace, Menlo, monospace;
  background: var(--bg-input);
  resize: vertical;
  line-height: 1.5;
}
.paste:focus { border-color: var(--teal); outline: none; }
.import-row { margin-top: 8px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.status { font-size: 12px; font-weight: 700; color: var(--fg-faint); }
.status.good { color: var(--ok); }
.status.bad { color: var(--danger); }
.replace {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--fg-muted);
  cursor: pointer;
}
.replace input { width: 15px; height: 15px; accent-color: var(--teal); }
.modal-actions { margin-top: 16px; display: flex; gap: 10px; }

@media (max-width: 700px) {
  .page { padding: 24px 18px 48px; }
  .edit-grid { grid-template-columns: 1fr 1fr; }
}
</style>
