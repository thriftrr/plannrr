<script setup lang="ts">
// Calendrr's "cash on hand" popover: every on-budget account across the
// selected budgets, each with a checkbox (counts / doesn't), an editable
// balance, and the running total. Credit cards and lines of credit carry
// negative balances, so the total is what you could actually spend today.
// Selection and edits live in the recurring prefs (usePlanSelection's
// counterpart for money); this is just the face.

export interface CashRow {
  sourceId: string
  sourceName: string
  id: string
  name: string
  kind: 'cash' | 'credit'
  balance: number           // effective milliunits (override or synced)
  syncedBalance: number | null // what the last sync said; null for hand-added
  overridden: boolean
  manual: boolean
  included: boolean
}

const props = defineProps<{
  rows: CashRow[]
  total: number | null
  sources: Array<{ id: string, name: string }>
  multiSource: boolean
  fmt: (milliunits: number) => string
  refreshedAt?: string | null
  refreshing?: boolean
  error?: string
}>()
const emit = defineEmits<{
  refresh: []
  toggle: [row: CashRow]
  setBalance: [row: CashRow, milliunits: number]
  clearOverride: [row: CashRow]
  remove: [row: CashRow]
  add: [sourceId: string, name: string, kind: 'cash' | 'credit', milliunits: number]
}>()

const open = ref(false)
const root = ref<HTMLElement>()

function onDocClick (e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

const faceLabel = computed(() => props.total === null ? 'Cash on hand' : `${props.fmt(props.total)} on hand`)

const refreshedLabel = computed(() => {
  if (!props.refreshedAt) return ''
  const at = new Date(props.refreshedAt)
  const sameDay = at.toDateString() === new Date().toDateString()
  return sameDay
    ? `as of ${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    : `as of ${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
})

const grouped = computed(() => {
  const map = new Map<string, { name: string, rows: CashRow[] }>()
  for (const row of props.rows) {
    const bucket = map.get(row.sourceId) ?? { name: row.sourceName, rows: [] }
    bucket.rows.push(row)
    map.set(row.sourceId, bucket)
  }
  return [...map.entries()].map(([id, bucket]) => ({ id, ...bucket }))
})

// Balances are typed in plain currency units; credit rows are entered as the
// amount owed (positive) and stored negative.
const editing = ref<Record<string, string>>({})
const rowKey = (row: CashRow) => `${row.sourceId}:${row.id}`
const shown = (row: CashRow) => editing.value[rowKey(row)] ?? (Math.abs(row.balance) / 1000).toFixed(2)

function commit (row: CashRow) {
  const raw = editing.value[rowKey(row)]
  delete editing.value[rowKey(row)]
  if (raw === undefined) return
  const value = Number.parseFloat(raw.replace(/[$,\s]/g, ''))
  if (!Number.isFinite(value)) return
  const milli = Math.round(Math.abs(value) * 1000) * (row.kind === 'credit' ? -1 : 1)
  if (milli !== row.balance) emit('setBalance', row, milli)
}

const adding = ref(false)
const form = ref({ sourceId: '', name: '', kind: 'cash' as 'cash' | 'credit', balance: '' })
function startAdd () {
  form.value = { sourceId: props.sources[0]?.id ?? '', name: '', kind: 'cash', balance: '' }
  adding.value = true
}
function submitAdd () {
  const value = Number.parseFloat(form.value.balance.replace(/[$,\s]/g, ''))
  if (!form.value.sourceId || !form.value.name.trim() || !Number.isFinite(value)) return
  emit('add', form.value.sourceId, form.value.name.trim(), form.value.kind, Math.round(Math.abs(value) * 1000) * (form.value.kind === 'credit' ? -1 : 1))
  adding.value = false
}
</script>

<template>
  <div ref="root" class="picker">
    <button class="face" :class="{ open, neg: total !== null && total < 0 }" :title="total === null ? 'Add your accounts to anchor the balance line' : 'Every counted account, credit cards subtracted'" @click="open = !open">
      <span class="face-label">{{ faceLabel }}</span>
      <span class="caret">▼</span>
    </button>
    <div v-if="open" class="pop" @click.stop>
      <div class="caption-row">
        <div class="caption">Cash on hand</div>
        <button class="refresh" :disabled="refreshing" :title="refreshedAt ? `Balances from YNAB ${refreshedLabel}` : 'Read live balances from YNAB'" @click="emit('refresh')">
          {{ refreshing ? 'Reading YNAB…' : `↻ Refresh${refreshedLabel ? ' · ' + refreshedLabel : ''}` }}
        </button>
      </div>
      <div v-if="error" class="error">{{ error }}</div>

      <div v-if="!rows.length" class="empty">
        No accounts yet — add your checking, savings, and cards below and the balance line starts from their total.
      </div>

      <template v-for="group in grouped" :key="group.id">
        <div v-if="multiSource" class="source-name">{{ group.name }}</div>
        <div v-for="row in group.rows" :key="row.id" class="row" :class="{ off: !row.included }">
          <input
            type="checkbox"
            :checked="row.included"
            :aria-label="`Count ${row.name}`"
            @change="emit('toggle', row)"
          >
          <div class="who">
            <span class="name">{{ row.name }}</span>
            <span v-if="row.kind === 'credit'" class="tag">credit</span>
            <span v-else-if="row.manual" class="tag soft">hand-added</span>
          </div>
          <div class="amt" :class="{ credit: row.kind === 'credit' }">
            <span v-if="row.kind === 'credit'" class="sign">−</span>
            <input
              type="text"
              inputmode="decimal"
              :value="shown(row)"
              :aria-label="`${row.name} balance`"
              :title="row.overridden && row.syncedBalance !== null ? `Edited here — the last sync said ${fmt(row.syncedBalance)}` : row.kind === 'credit' ? 'Amount owed' : 'Balance'"
              :class="{ edited: row.overridden }"
              @input="editing[rowKey(row)] = ($event.target as HTMLInputElement).value"
              @change="commit(row)"
              @keyup.enter="($event.target as HTMLInputElement).blur()"
            >
          </div>
          <button
            v-if="row.manual"
            class="mini"
            title="Remove this account"
            @click="emit('remove', row)"
          >✕</button>
          <button
            v-else
            class="mini"
            :class="{ ghost: !row.overridden }"
            :tabindex="row.overridden ? 0 : -1"
            :title="row.syncedBalance !== null ? `Back to the synced ${fmt(row.syncedBalance)}` : ''"
            @click="emit('clearOverride', row)"
          >↺</button>
        </div>
      </template>

      <div v-if="rows.length" class="total" :class="{ neg: (total ?? 0) < 0 }">
        <span>Cash on hand</span>
        <b>{{ fmt(total ?? 0) }}</b>
      </div>

      <div v-if="adding" class="add-form">
        <select v-if="sources.length > 1" v-model="form.sourceId" aria-label="Plan">
          <option v-for="s in sources" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <input v-model="form.name" type="text" placeholder="Account name" aria-label="Account name" maxlength="80" @keyup.enter="submitAdd">
        <div class="add-row">
          <select v-model="form.kind" aria-label="Account type">
            <option value="cash">cash (checking, savings)</option>
            <option value="credit">credit (card, line of credit)</option>
          </select>
          <input v-model="form.balance" type="text" inputmode="decimal" :placeholder="form.kind === 'credit' ? 'owed' : '$'" aria-label="Balance" @keyup.enter="submitAdd">
        </div>
        <div class="add-actions">
          <button class="add-go" @click="submitAdd">Add</button>
          <button class="add-cancel" @click="adding = false">Cancel</button>
        </div>
      </div>
      <button v-else class="add" @click="startAdd">+ Add an account</button>

      <div class="note">Balances come live from YNAB each visit; a balance you type here sticks until you reset it. Cards and credit lines subtract.</div>
    </div>
  </div>
</template>

<style scoped>
.picker { position: relative; }
.face {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 260px;
  padding: 8px 12px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-sm);
  background: var(--bg-card);
  font-size: 13.5px;
  font-weight: 700;
  color: var(--teal-dark);
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.face.open { border-color: var(--teal); }
.face.neg { color: var(--danger); }
.face-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.caret { font-size: 10px; color: var(--fg-subtle); }

.pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  width: 340px;
  background: var(--bg-card);
  border: 1.5px solid var(--border-input);
  border-radius: 10px;
  box-shadow: 0 6px 20px rgba(43, 42, 38, 0.14);
  padding: 8px;
}
.caption, .source-name {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.7px;
  text-transform: uppercase;
  color: var(--fg-subtle);
  padding: 4px 8px 6px;
}
.source-name { padding-top: 8px; color: var(--teal-dark); }
.caption-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.refresh {
  border: none;
  background: none;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
  color: var(--teal-dark);
  cursor: pointer;
  white-space: nowrap;
}
.refresh:hover:not(:disabled) { text-decoration: underline; }
.refresh:disabled { color: var(--fg-faint); cursor: default; }
.error { margin: 0 8px 6px; padding: 6px 8px; font-size: 11.5px; color: var(--danger); background: var(--danger-bg); border-radius: var(--r-xs); }
.empty { padding: 4px 8px 8px; font-size: 12.5px; color: var(--fg-muted); line-height: 1.45; }
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--r-xs);
}
.row:hover { background: var(--bg-app); }
.row.off { opacity: 0.5; }
.row input[type="checkbox"] { width: 15px; height: 15px; accent-color: var(--teal); flex: none; }
.who { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; }
.name { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tag {
  flex: none;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--danger);
  background: var(--danger-bg);
  border-radius: 999px;
  padding: 1px 6px;
}
.tag.soft { color: var(--fg-subtle); background: var(--bg-sunk); }
.amt { display: flex; align-items: center; gap: 2px; flex: none; }
.amt .sign { font-size: 12px; font-weight: 800; color: var(--danger); }
.amt input {
  width: 92px;
  text-align: right;
  padding: 4px 7px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-xs);
  font-size: 12.5px;
  font-weight: 700;
  background: var(--bg-input);
  font-variant-numeric: tabular-nums;
}
.amt input.edited { border-color: var(--teal); }
.amt input:focus { outline: none; border-color: var(--teal); }
.amt.credit input { color: var(--danger); }
.mini {
  flex: none;
  width: 18px;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--teal);
  font-size: 13px;
  padding: 0;
}
.mini.ghost { visibility: hidden; }
.total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 6px 0 4px;
  padding: 8px 8px;
  border-top: 1.5px solid var(--border-soft);
  font-size: 13px;
  font-weight: 700;
}
.total b { font-size: 15px; font-weight: 800; color: var(--teal-dark); font-variant-numeric: tabular-nums; }
.total.neg b { color: var(--danger); }
.add {
  width: 100%;
  margin-top: 4px;
  padding: 7px 8px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--r-xs);
  background: none;
  color: var(--teal-dark);
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  text-align: left;
}
.add:hover { background: var(--bg-app); }
.add-form { display: flex; flex-direction: column; gap: 6px; padding: 6px 4px 2px; }
.add-form input, .add-form select {
  width: 100%;
  padding: 6px 8px;
  border: 1.5px solid var(--border-input);
  border-radius: var(--r-xs);
  font-size: 12.5px;
  font-weight: 600;
  background: var(--bg-input);
}
.add-form input:focus, .add-form select:focus { outline: none; border-color: var(--teal); }
.add-row { display: grid; grid-template-columns: 1fr 96px; gap: 6px; }
.add-actions { display: flex; gap: 8px; }
.add-go {
  padding: 6px 14px;
  border: none;
  border-radius: var(--r-xs);
  background: var(--teal);
  color: #fff;
  font-weight: 800;
  font-size: 12.5px;
  cursor: pointer;
}
.add-cancel { border: none; background: none; color: var(--fg-subtle); font-weight: 700; font-size: 12.5px; cursor: pointer; }
.note { padding: 8px 8px 2px; font-size: 11px; color: var(--fg-faint); line-height: 1.4; }
@media (max-width: 759px) {
  .face { max-width: none; min-height: 44px; }
  .pop {
    position: fixed;
    top: auto;
    left: 0;
    right: 0;
    bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
    width: auto;
    max-height: 70vh;
    max-height: 70dvh;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
    z-index: 45;
    border-radius: 14px 14px 0 0;
    padding: 10px 12px 14px;
    box-shadow: 0 -6px 24px rgba(43, 42, 38, 0.18);
  }
  .row { min-height: 44px; }
  .row input[type="checkbox"] { width: 20px; height: 20px; }
  .amt input { min-height: 40px; width: 110px; }
  .mini { width: 32px; min-height: 40px; }
  .add { min-height: 44px; }
  .add-form input, .add-form select { min-height: 44px; }
  .add-go, .add-cancel { min-height: 44px; }
}
</style>
